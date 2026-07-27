/*
 * serial.js — 序列化格式识别组（T76，cat:'analysis'）。
 *
 * 覆盖（全部 run 单向，返回多行报告文本）：
 * - protobufParse：Protobuf wire 格式解析（无 schema，按 wire type 解析）
 * - msgpackParse：MessagePack 解析
 * - cborParse：CBOR 解析（RFC 8949）
 * - bsonParse：BSON 文档解析（bsonspec.org）
 * - phpSerializeParse：PHP serialize 解析
 * - javaSerializeIdent：Java 序列化 magic(0xACED) 识别 + 顶层结构
 *
 * 算法标准（照公开规范实现，不编造）：
 * - Protobuf: https://protobuf.dev/programming-guides/encoding/
 * - MessagePack: https://github.com/msgpack/msgpack/blob/master/spec.md
 * - CBOR: RFC 8949
 * - BSON: http://bsonspec.org/spec.html
 * - PHP serialize: https://www.php.net/manual/en/function.serialize.php
 * - Java: Java Object Serialization Protocol (java.io.ObjectStreamConstants)
 *
 * 二进制输入复用 compress.js 的 inputToBytes（hex/base64/utf8 自动识别）。
 */
import { register } from "./registry.js";
import { inputToBytes } from "./compress.js";

const INPUT_ENC_PARAM = {
  key: "inputEnc", label: "输入编码", type: "select", default: "auto",
  options: [
    { value: "auto", label: "自动（hex/base64/UTF-8）" },
    { value: "hex", label: "Hex" },
    { value: "base64", label: "Base64" },
    { value: "utf8", label: "UTF-8 文本" },
  ],
};

// ============ 通用工具 ============
function bytesToHex(bytes, max = 1024) {
  const n = Math.min(bytes.length, max);
  let s = "";
  for (let i = 0; i < n; i++) s += bytes[i].toString(16).padStart(2, "0");
  if (bytes.length > max) s += `…(${bytes.length} bytes)`;
  return s;
}
function tryUtf8(bytes) {
  if (bytes.length === 0) return null;
  try {
    const s = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    let ctrl = 0;
    for (const ch of s) {
      const c = ch.codePointAt(0);
      if (c < 0x20 && c !== 0x0A && c !== 0x0D && c !== 0x09) ctrl++;
    }
    if (ctrl / s.length < 0.1) return s;
  } catch {}
  return null;
}
function hasBigInt() { return typeof BigInt !== "undefined"; }

// ============ Protobuf wire 解析 ============
function readVarint(bytes, pos) {
  let result = 0n;
  let shift = 0n;
  for (let count = 0; count < 10; count++) {
    if (pos >= bytes.length) throw new Error("varint 读取越界");
    const b = bytes[pos++];
    result |= BigInt(b & 0x7f) << shift;
    shift += 7n;
    if ((b & 0x80) === 0) return { value: result, pos };
  }
  throw new Error("varint 超过 10 字节（损坏）");
}
function zigzagDecode(n) { return (n >> 1n) ^ -(n & 1n); }

const PROTO_WIRE_TYPES = {
  0: "Varint", 1: "64-bit", 2: "Length-delimited",
  3: "Start group", 4: "End group", 5: "32-bit",
};

function protobufParseFields(bytes, depth = 0, maxDepth = 32) {
  const fields = [];
  let pos = 0;
  while (pos < bytes.length) {
    const fieldStart = pos;
    let key;
    try { ({ value: key, pos } = readVarint(bytes, pos)); }
    catch (e) { return { fields, consumed: pos, error: "key varint: " + e.message }; }
    const wireType = Number(key & 7n);
    const fieldNumber = Number(key >> 3n);
    if (fieldNumber <= 0) return { fields, consumed: pos, error: `非法 field number: ${fieldNumber}` };
    const f = { fieldNumber, wireType, wireTypeStr: PROTO_WIRE_TYPES[wireType] || `未知(${wireType})`, offset: fieldStart };
    try {
      if (wireType === 0) {
        let v; ({ value: v, pos } = readVarint(bytes, pos));
        f.value = v.toString();
        f.valueHex = "0x" + v.toString(16).toUpperCase();
        const zz = zigzagDecode(v);
        if (zz >= -1000000n && zz <= 1000000n) f.hint = `zigzag→${zz.toString()}`;
      } else if (wireType === 1) {
        if (pos + 8 > bytes.length) throw new Error("64-bit 数据不足");
        const b = bytes.slice(pos, pos + 8); pos += 8;
        f.valueHex = "0x" + bytesToHex(b).toUpperCase();
        const dv = new DataView(new ArrayBuffer(8));
        for (let i = 0; i < 8; i++) dv.setUint8(i, b[i]);
        let i64 = "";
        if (hasBigInt()) { try { i64 = dv.getBigInt64(0, true).toString(); } catch {} }
        f.value = `int64(LE)=${i64}, double(LE)=${dv.getFloat64(0, true)}`;
      } else if (wireType === 5) {
        if (pos + 4 > bytes.length) throw new Error("32-bit 数据不足");
        const b = bytes.slice(pos, pos + 4); pos += 4;
        f.valueHex = "0x" + bytesToHex(b).toUpperCase();
        const dv = new DataView(new ArrayBuffer(4));
        for (let i = 0; i < 4; i++) dv.setUint8(i, b[i]);
        f.value = `int32(LE)=${dv.getInt32(0, true)}, float(LE)=${dv.getFloat32(0, true)}`;
      } else if (wireType === 2) {
        let v; ({ value: v, pos } = readVarint(bytes, pos));
        const len = Number(v);
        if (len < 0 || pos + len > bytes.length) throw new Error(`length-delimited 长度 ${len} 越界`);
        const data = bytes.slice(pos, pos + len); pos += len;
        f.length = len;
        const str = tryUtf8(data);
        if (str !== null) {
          f.value = `string="${str}"`;
        } else if (depth < maxDepth) {
          try {
            const sub = protobufParseFields(data, depth + 1, maxDepth);
            if (sub.fields.length > 0 && !sub.error && sub.consumed === data.length) {
              f.value = `message(${sub.fields.length} fields)`;
              f.nested = sub.fields;
            } else {
              f.value = `bytes[${len}]=${bytesToHex(data, 32)}`;
            }
          } catch { f.value = `bytes[${len}]=${bytesToHex(data, 32)}`; }
        } else {
          f.value = `bytes[${len}]=${bytesToHex(data, 32)}`;
        }
      } else if (wireType === 3) { f.value = "（start group，已弃用）"; }
      else if (wireType === 4) { f.value = "（end group，已弃用）"; }
      else { return { fields, consumed: pos, error: `未知 wire type: ${wireType}` }; }
    } catch (e) {
      f.error = e.message;
      return { fields, consumed: pos, error: e.message };
    }
    fields.push(f);
  }
  return { fields, consumed: pos, error: null };
}

function formatProtobufFields(fields, indent = "") {
  const lines = [];
  for (const f of fields) {
    let line = `${indent}field ${f.fieldNumber} (${f.wireTypeStr}): ${f.value || ""}`;
    if (f.hint) line += `  [${f.hint}]`;
    if (f.valueHex) line += `  ${f.valueHex}`;
    line += `  @off=${f.offset}`;
    lines.push(line);
    if (f.nested && f.nested.length > 0) lines.push(...formatProtobufFields(f.nested, indent + "  "));
  }
  return lines;
}

function protobufParseRun(text, p) {
  const bytes = (p && p.rawBytes && p.rawBytes.length)
    ? (p.rawBytes instanceof Uint8Array ? p.rawBytes : new Uint8Array(p.rawBytes))
    : inputToBytes(text, p);
  if (bytes.length === 0) return "请输入 protobuf 二进制数据（hex 或 base64）";
  const lines = ["=== Protobuf Wire 解析 ===", `输入: ${bytes.length} 字节`, ""];
  const r = protobufParseFields(bytes);
  if (r.fields.length === 0) { lines.push("未解析出任何字段（输入可能不是合法 protobuf wire 格式）"); return lines.join("\n"); }
  lines.push(...formatProtobufFields(r.fields));
  if (r.error) { lines.push(""); lines.push(`⚠ 解析中断: ${r.error}`); }
  if (r.consumed < bytes.length) { lines.push(""); lines.push(`⚠ 仅消费 ${r.consumed}/${bytes.length} 字节，剩余 ${bytes.length - r.consumed} 字节未解析`); }
  return lines.join("\n");
}

// ============ MessagePack 解析 ============
function msgpackParse(bytes, pos = 0, depth = 0, maxDepth = 128) {
  if (depth > maxDepth) throw new Error("嵌套深度超限");
  if (pos >= bytes.length) throw new Error("msgpack 读取越界");
  const b = bytes[pos++];
  const u32BE = (o) => ((bytes[o] << 24) | (bytes[o + 1] << 16) | (bytes[o + 2] << 8) | bytes[o + 3]) >>> 0;
  const u16BE = (o) => (bytes[o] << 8) | bytes[o + 1];
  if (b <= 0x7f) return { value: b, pos, type: "uint8" };
  if (b >= 0x80 && b <= 0x8f) {
    const n = b & 0x0f, map = [];
    for (let i = 0; i < n; i++) { const k = msgpackParse(bytes, pos, depth + 1, maxDepth); pos = k.pos; const v = msgpackParse(bytes, pos, depth + 1, maxDepth); pos = v.pos; map.push({ key: k, value: v }); }
    return { value: map, pos, type: "map", count: n };
  }
  if (b >= 0x90 && b <= 0x9f) {
    const n = b & 0x0f, arr = [];
    for (let i = 0; i < n; i++) { const v = msgpackParse(bytes, pos, depth + 1, maxDepth); pos = v.pos; arr.push(v); }
    return { value: arr, pos, type: "array", count: n };
  }
  if (b >= 0xa0 && b <= 0xbf) {
    const len = b & 0x1f;
    if (pos + len > bytes.length) throw new Error("fixstr 越界");
    const s = new TextDecoder("utf-8", { fatal: false }).decode(bytes.slice(pos, pos + len));
    return { value: s, pos: pos + len, type: "str" };
  }
  if (b === 0xc0) return { value: null, pos, type: "nil" };
  if (b === 0xc2) return { value: false, pos, type: "bool" };
  if (b === 0xc3) return { value: true, pos, type: "bool" };
  if (b === 0xc4) { const len = bytes[pos++]; const d = bytes.slice(pos, pos + len); pos += len; return { value: d, pos, type: "bin", length: len }; }
  if (b === 0xc5) { const len = u16BE(pos); pos += 2; const d = bytes.slice(pos, pos + len); pos += len; return { value: d, pos, type: "bin", length: len }; }
  if (b === 0xc6) { const len = u32BE(pos); pos += 4; const d = bytes.slice(pos, pos + len); pos += len; return { value: d, pos, type: "bin", length: len }; }
  if (b === 0xc7) { const len = bytes[pos++]; const t = bytes[pos++]; const d = bytes.slice(pos, pos + len); pos += len; return { value: d, pos, type: "ext", extType: t, length: len }; }
  if (b === 0xc8) { const len = u16BE(pos); pos += 2; const t = bytes[pos++]; const d = bytes.slice(pos, pos + len); pos += len; return { value: d, pos, type: "ext", extType: t, length: len }; }
  if (b === 0xc9) { const len = u32BE(pos); pos += 4; const t = bytes[pos++]; const d = bytes.slice(pos, pos + len); pos += len; return { value: d, pos, type: "ext", extType: t, length: len }; }
  if (b === 0xca) { const dv = new DataView(new ArrayBuffer(4)); for (let i = 0; i < 4; i++) dv.setUint8(i, bytes[pos + i]); pos += 4; return { value: dv.getFloat32(0, false), pos, type: "float32" }; }
  if (b === 0xcb) { const dv = new DataView(new ArrayBuffer(8)); for (let i = 0; i < 8; i++) dv.setUint8(i, bytes[pos + i]); pos += 8; return { value: dv.getFloat64(0, false), pos, type: "float64" }; }
  if (b === 0xcc) return { value: bytes[pos++], pos, type: "uint8" };
  if (b === 0xcd) { const v = u16BE(pos); pos += 2; return { value: v, pos, type: "uint16" }; }
  if (b === 0xce) { const v = u32BE(pos); pos += 4; return { value: v, pos, type: "uint32" }; }
  if (b === 0xcf) { const hi = u32BE(pos); const lo = u32BE(pos + 4); pos += 8; return { value: hasBigInt() ? (BigInt(hi) << 32n | BigInt(lo)) : (hi * 0x100000000 + lo), pos, type: "uint64" }; }
  if (b === 0xd0) { const v = bytes[pos++]; return { value: v > 0x7f ? v - 0x100 : v, pos, type: "int8" }; }
  if (b === 0xd1) { const v = u16BE(pos); pos += 2; return { value: v > 0x7fff ? v - 0x10000 : v, pos, type: "int16" }; }
  if (b === 0xd2) { const v = u32BE(pos) | 0; pos += 4; return { value: v, pos, type: "int32" }; }
  if (b === 0xd3) { const dv = new DataView(new ArrayBuffer(8)); for (let i = 0; i < 8; i++) dv.setUint8(i, bytes[pos + i]); pos += 8; return { value: hasBigInt() ? dv.getBigInt64(0, false) : dv.getFloat64(0, false), pos, type: "int64" }; }
  if (b >= 0xd4 && b <= 0xd8) { const sizes = { 0xd4: 1, 0xd5: 2, 0xd6: 4, 0xd7: 8, 0xd8: 16 }; const len = sizes[b]; const t = bytes[pos++]; const d = bytes.slice(pos, pos + len); pos += len; return { value: d, pos, type: "ext", extType: t, length: len }; }
  if (b === 0xd9) { const len = bytes[pos++]; const s = new TextDecoder("utf-8", { fatal: false }).decode(bytes.slice(pos, pos + len)); return { value: s, pos: pos + len, type: "str" }; }
  if (b === 0xda) { const len = u16BE(pos); pos += 2; const s = new TextDecoder("utf-8", { fatal: false }).decode(bytes.slice(pos, pos + len)); return { value: s, pos: pos + len, type: "str" }; }
  if (b === 0xdb) { const len = u32BE(pos); pos += 4; const s = new TextDecoder("utf-8", { fatal: false }).decode(bytes.slice(pos, pos + len)); return { value: s, pos: pos + len, type: "str" }; }
  if (b === 0xdc) { const n = u16BE(pos); pos += 2; const arr = []; for (let i = 0; i < n; i++) { const v = msgpackParse(bytes, pos, depth + 1, maxDepth); pos = v.pos; arr.push(v); } return { value: arr, pos, type: "array", count: n }; }
  if (b === 0xdd) { const n = u32BE(pos); pos += 4; const arr = []; for (let i = 0; i < n; i++) { const v = msgpackParse(bytes, pos, depth + 1, maxDepth); pos = v.pos; arr.push(v); } return { value: arr, pos, type: "array", count: n }; }
  if (b === 0xde) { const n = u16BE(pos); pos += 2; const map = []; for (let i = 0; i < n; i++) { const k = msgpackParse(bytes, pos, depth + 1, maxDepth); pos = k.pos; const v = msgpackParse(bytes, pos, depth + 1, maxDepth); pos = v.pos; map.push({ key: k, value: v }); } return { value: map, pos, type: "map", count: n }; }
  if (b === 0xdf) { const n = u32BE(pos); pos += 4; const map = []; for (let i = 0; i < n; i++) { const k = msgpackParse(bytes, pos, depth + 1, maxDepth); pos = k.pos; const v = msgpackParse(bytes, pos, depth + 1, maxDepth); pos = v.pos; map.push({ key: k, value: v }); } return { value: map, pos, type: "map", count: n }; }
  if (b >= 0xe0) return { value: b - 0x100, pos, type: "int8" };
  throw new Error(`未知 msgpack 字节: 0x${b.toString(16).padStart(2, "0")} @pos=${pos - 1}`);
}

function formatMsgpack(node, indent = "") {
  const lines = [];
  const v = node.value, t = node.type;
  if (v === null && t === "nil") lines.push(`${indent}nil`);
  else if (t === "bool") lines.push(`${indent}${v}`);
  else if (t === "str") lines.push(`${indent}str: "${v}"`);
  else if (t === "bin") lines.push(`${indent}bin[${node.length}]: ${bytesToHex(v, 32)}`);
  else if (t === "ext") lines.push(`${indent}ext[${node.length}] type=${node.extType}: ${bytesToHex(v, 32)}`);
  else if (t === "float32" || t === "float64") lines.push(`${indent}${t}: ${v}`);
  else if (t === "array") { lines.push(`${indent}array[${node.count}]:`); for (const it of v) lines.push(...formatMsgpack(it, indent + "  ")); }
  else if (t === "map") { lines.push(`${indent}map[${node.count}]:`); for (const e of v) { const ks = e.key.type === "str" ? `"${e.key.value}"` : e.key.value; lines.push(`${indent}  ${ks}:`); lines.push(...formatMsgpack(e.value, indent + "    ")); } }
  else lines.push(`${indent}${t}: ${typeof v === "bigint" ? v.toString() : v}`);
  return lines;
}

function msgpackParseRun(text, p) {
  const bytes = (p && p.rawBytes && p.rawBytes.length)
    ? (p.rawBytes instanceof Uint8Array ? p.rawBytes : new Uint8Array(p.rawBytes))
    : inputToBytes(text, p);
  if (bytes.length === 0) return "请输入 MessagePack 二进制数据（hex 或 base64）";
  const lines = ["=== MessagePack 解析 ===", `输入: ${bytes.length} 字节`, ""];
  try {
    const r = msgpackParse(bytes, 0);
    lines.push(...formatMsgpack(r));
    if (r.pos < bytes.length) { lines.push(""); lines.push(`⚠ 仅消费 ${r.pos}/${bytes.length} 字节，剩余 ${bytes.length - r.pos} 字节`); }
  } catch (e) { lines.push(`⚠ 解析失败: ${e.message}`); }
  return lines.join("\n");
}

// ============ CBOR 解析（RFC 8949） ============
function cborReadHead(bytes, pos) {
  if (pos >= bytes.length) throw new Error("cbor 读取越界");
  const b = bytes[pos++];
  const mt = b >> 5;          // major type 0-7
  const ai = b & 0x1f;        // additional info 0-31
  let value = null, rawAi = ai;
  if (ai < 24) value = ai;
  else if (ai === 24) { value = bytes[pos++]; }
  else if (ai === 25) { const dv = new DataView(new ArrayBuffer(2)); dv.setUint8(0, bytes[pos]); dv.setUint8(1, bytes[pos + 1]); pos += 2; value = dv.getUint16(0, false); }
  else if (ai === 26) { const dv = new DataView(new ArrayBuffer(4)); for (let i = 0; i < 4; i++) dv.setUint8(i, bytes[pos + i]); pos += 4; value = dv.getUint32(0, false); }
  else if (ai === 27) { if (hasBigInt()) { const dv = new DataView(new ArrayBuffer(8)); for (let i = 0; i < 8; i++) dv.setUint8(i, bytes[pos + i]); pos += 8; value = dv.getBigUint64(0, false); } else { const hi = ((bytes[pos] << 24) | (bytes[pos + 1] << 16) | (bytes[pos + 2] << 8) | bytes[pos + 3]) >>> 0; const lo = ((bytes[pos + 4] << 24) | (bytes[pos + 5] << 16) | (bytes[pos + 6] << 8) | bytes[pos + 7]) >>> 0; pos += 8; value = hi * 0x100000000 + lo; } }
  else if (ai === 31) { value = null; } // break / indefinite
  else throw new Error(`cbor 保留 ai=${ai}`);
  return { mt, ai: rawAi, value, pos };
}

function cborParse(bytes, pos = 0, depth = 0, maxDepth = 128) {
  if (depth > maxDepth) throw new Error("嵌套深度超限");
  const head = cborReadHead(bytes, pos);
  pos = head.pos;
  const { mt, ai, value: aiVal } = head;
  if (mt === 0) { // unsigned int
    return { value: aiVal, pos, type: "uint", mt: 0 };
  }
  if (mt === 1) { // negative int: -1 - n
    let n = aiVal;
    if (typeof n === "bigint") return { value: -1n - n, pos, type: "nint", mt: 1 };
    return { value: -1 - n, pos, type: "nint", mt: 1 };
  }
  if (mt === 2) { // byte string
    let len = aiVal;
    if (ai === 31) { // indefinite
      const chunks = [];
      while (true) {
        if (pos >= bytes.length) throw new Error("cbor indefinite bstr 未结束");
        if (bytes[pos] === 0xFF) { pos++; break; }
        const sub = cborParse(bytes, pos, depth + 1, maxDepth);
        pos = sub.pos;
        if (sub.mt !== 2) throw new Error("indefinite bstr 含非 bstr 项");
        chunks.push(sub.value);
      }
      const total = chunks.reduce((a, c) => a + c.length, 0);
      const out = new Uint8Array(total); let o = 0;
      for (const c of chunks) { out.set(c, o); o += c.length; }
      return { value: out, pos, type: "bstr", mt: 2, indefinite: true };
    }
    if (pos + len > bytes.length) throw new Error("cbor bstr 越界");
    const d = bytes.slice(pos, pos + len); pos += len;
    return { value: d, pos, type: "bstr", mt: 2, length: len };
  }
  if (mt === 3) { // text string
    let len = aiVal;
    if (ai === 31) {
      const chunks = [];
      while (true) {
        if (pos >= bytes.length) throw new Error("cbor indefinite tstr 未结束");
        if (bytes[pos] === 0xFF) { pos++; break; }
        const sub = cborParse(bytes, pos, depth + 1, maxDepth);
        pos = sub.pos;
        if (sub.mt !== 3) throw new Error("indefinite tstr 含非 tstr 项");
        chunks.push(sub.value);
      }
      return { value: chunks.join(""), pos, type: "tstr", mt: 3, indefinite: true };
    }
    if (pos + len > bytes.length) throw new Error("cbor tstr 越界");
    const s = new TextDecoder("utf-8", { fatal: false }).decode(bytes.slice(pos, pos + len));
    pos += len;
    return { value: s, pos, type: "tstr", mt: 3, length: len };
  }
  if (mt === 4) { // array
    if (ai === 31) { // indefinite
      const arr = [];
      while (true) {
        if (pos >= bytes.length) throw new Error("cbor indefinite array 未结束");
        if (bytes[pos] === 0xFF) { pos++; break; }
        const sub = cborParse(bytes, pos, depth + 1, maxDepth);
        pos = sub.pos;
        arr.push(sub);
      }
      return { value: arr, pos, type: "array", mt: 4, indefinite: true };
    }
    const arr = [];
    for (let i = 0; i < aiVal; i++) { const sub = cborParse(bytes, pos, depth + 1, maxDepth); pos = sub.pos; arr.push(sub); }
    return { value: arr, pos, type: "array", mt: 4, count: Number(aiVal) };
  }
  if (mt === 5) { // map
    if (ai === 31) {
      const map = [];
      while (true) {
        if (pos >= bytes.length) throw new Error("cbor indefinite map 未结束");
        if (bytes[pos] === 0xFF) { pos++; break; }
        const k = cborParse(bytes, pos, depth + 1, maxDepth); pos = k.pos;
        const v = cborParse(bytes, pos, depth + 1, maxDepth); pos = v.pos;
        map.push({ key: k, value: v });
      }
      return { value: map, pos, type: "map", mt: 5, indefinite: true };
    }
    const map = [];
    for (let i = 0; i < aiVal; i++) { const k = cborParse(bytes, pos, depth + 1, maxDepth); pos = k.pos; const v = cborParse(bytes, pos, depth + 1, maxDepth); pos = v.pos; map.push({ key: k, value: v }); }
    return { value: map, pos, type: "map", mt: 5, count: Number(aiVal) };
  }
  if (mt === 6) { // tag
    const sub = cborParse(bytes, pos, depth + 1, maxDepth);
    pos = sub.pos;
    return { value: sub, pos, type: "tag", mt: 6, tag: aiVal };
  }
  if (mt === 7) { // simple/float/break（aiVal 已由 cborReadHead 读取后续字节）
    if (ai === 20) return { value: false, pos, type: "bool", mt: 7 };
    if (ai === 21) return { value: true, pos, type: "bool", mt: 7 };
    if (ai === 22) return { value: null, pos, type: "null", mt: 7 };
    if (ai === 23) return { value: undefined, pos, type: "undefined", mt: 7 };
    if (ai === 25) { // half-float (16 bit)，aiVal 是 uint16
      const h = aiVal;
      const sign = (h >> 15) & 1;
      const exp = (h >> 10) & 0x1f;
      const frac = h & 0x3ff;
      let val;
      if (exp === 0) val = (sign ? -1 : 1) * Math.pow(2, -14) * (frac / 1024);
      else if (exp === 31) val = frac ? NaN : (sign ? -Infinity : Infinity);
      else val = (sign ? -1 : 1) * Math.pow(2, exp - 15) * (1 + frac / 1024);
      return { value: val, pos, type: "float16", mt: 7 };
    }
    if (ai === 26) { // float32，aiVal 是 uint32
      const dv = new DataView(new ArrayBuffer(4)); dv.setUint32(0, aiVal, false);
      return { value: dv.getFloat32(0, false), pos, type: "float32", mt: 7 };
    }
    if (ai === 27) { // float64，aiVal 是 BigUint64 或 number
      const dv = new DataView(new ArrayBuffer(8));
      if (typeof aiVal === "bigint") dv.setBigUint64(0, aiVal, false);
      else { dv.setUint32(0, Math.floor(aiVal / 0x100000000), false); dv.setUint32(4, aiVal & 0xFFFFFFFF, false); }
      return { value: dv.getFloat64(0, false), pos, type: "float64", mt: 7 };
    }
    if (ai === 31) return { value: "break", pos, type: "break", mt: 7 };
    return { value: ai, pos, type: "simple", mt: 7, simple: ai };
  }
  throw new Error(`cbor 未知 major type: ${mt}`);
}

function formatCbor(node, indent = "") {
  const lines = [];
  const v = node.value, t = node.type;
  if (t === "uint") lines.push(`${indent}uint: ${typeof v === "bigint" ? v.toString() : v}`);
  else if (t === "nint") lines.push(`${indent}nint: ${typeof v === "bigint" ? v.toString() : v}`);
  else if (t === "bstr") lines.push(`${indent}bstr[${node.length ?? "?"}]: ${bytesToHex(v, 32)}${node.indefinite ? " (indefinite)" : ""}`);
  else if (t === "tstr") lines.push(`${indent}tstr: "${v}"${node.indefinite ? " (indefinite)" : ""}`);
  else if (t === "array") { lines.push(`${indent}array[${node.count ?? "?"}]:${node.indefinite ? " (indefinite)" : ""}`); for (const it of v) lines.push(...formatCbor(it, indent + "  ")); }
  else if (t === "map") { lines.push(`${indent}map[${node.count ?? "?"}]:${node.indefinite ? " (indefinite)" : ""}`); for (const e of v) { const ks = e.key.type === "tstr" ? `"${e.key.value}"` : (typeof e.key.value === "bigint" ? e.key.value.toString() : e.key.value); lines.push(`${indent}  ${ks}:`); lines.push(...formatCbor(e.value, indent + "    ")); } }
  else if (t === "tag") { lines.push(`${indent}tag(${typeof node.tag === "bigint" ? node.tag.toString() : node.tag}):`); lines.push(...formatCbor(v, indent + "  ")); }
  else if (t === "bool" || t === "null" || t === "undefined") lines.push(`${indent}${v}`);
  else if (t === "break") lines.push(`${indent}break`);
  else if (t.startsWith("float") || t === "simple") lines.push(`${indent}${t}: ${v}`);
  return lines;
}

function cborParseRun(text, p) {
  const bytes = (p && p.rawBytes && p.rawBytes.length)
    ? (p.rawBytes instanceof Uint8Array ? p.rawBytes : new Uint8Array(p.rawBytes))
    : inputToBytes(text, p);
  if (bytes.length === 0) return "请输入 CBOR 二进制数据（hex 或 base64）";
  const lines = ["=== CBOR 解析（RFC 8949） ===", `输入: ${bytes.length} 字节`, ""];
  try {
    const r = cborParse(bytes, 0);
    lines.push(...formatCbor(r));
    if (r.pos < bytes.length) { lines.push(""); lines.push(`⚠ 仅消费 ${r.pos}/${bytes.length} 字节，剩余 ${bytes.length - r.pos} 字节`); }
  } catch (e) { lines.push(`⚠ 解析失败: ${e.message}`); }
  return lines.join("\n");
}

// ============ BSON 解析（bsonspec.org） ============
const BSON_TYPES = {
  0x01: "double", 0x02: "string", 0x03: "document", 0x04: "array",
  0x05: "binary", 0x06: "undefined", 0x07: "ObjectId", 0x08: "bool",
  0x09: "datetime", 0x0A: "null", 0x0B: "regex", 0x0C: "dbPointer",
  0x0F: "javascript", 0x10: "int32", 0x11: "timestamp", 0x12: "int64",
  0x13: "decimal128", 0xFF: "minKey", 0x7F: "maxKey",
};
const BSON_BIN_SUBTYPES = {
  0x00: "generic", 0x01: "function", 0x02: "old binary", 0x03: "old UUID",
  0x04: "UUID", 0x05: "MD5", 0x06: "encrypted", 0x07: "column",
};

function readCString(bytes, pos) {
  let end = pos;
  while (end < bytes.length && bytes[end] !== 0) end++;
  if (end >= bytes.length) throw new Error("cstring 无终止符");
  const s = new TextDecoder("utf-8", { fatal: false }).decode(bytes.slice(pos, end));
  return { value: s, pos: end + 1 };
}

function bsonParseDocument(bytes, pos = 0, depth = 0, maxDepth = 64) {
  if (depth > maxDepth) throw new Error("BSON 嵌套深度超限");
  if (pos + 4 > bytes.length) throw new Error("BSON 文档长度不足");
  const len = ((bytes[pos] | (bytes[pos + 1] << 8) | (bytes[pos + 2] << 16) | (bytes[pos + 3] << 24)) | 0);
  pos += 4;
  if (len < 5 || pos + len - 4 > bytes.length) throw new Error(`BSON 文档长度 ${len} 非法/越界`);
  const docEnd = pos + len - 5; // 减去 len 自身 4 字节 + 终止符 1 字节
  const fields = [];
 // 循环边界用 docEnd（文档声明的长度），不用 bytes.length——嵌套文档缺终止符时不会越读兄弟数据。
  while (pos < docEnd && pos < bytes.length) {
    if (bytes[pos] === 0x00) { pos++; break; } // 终止符
    const type = bytes[pos++];
    const name = readCString(bytes, pos); pos = name.pos;
    const typeName = BSON_TYPES[type] || `未知(0x${type.toString(16)})`;
    const field = { name: name.value, type, typeName };
    if (type === 0x01) { // double
      const dv = new DataView(new ArrayBuffer(8)); for (let i = 0; i < 8; i++) dv.setUint8(i, bytes[pos + i]); pos += 8;
      field.value = dv.getFloat64(0, true);
    } else if (type === 0x02) { // string
      const slen = (bytes[pos] | (bytes[pos + 1] << 8) | (bytes[pos + 2] << 16) | (bytes[pos + 3] << 24)) | 0; pos += 4;
 // 负长度会使 pos 回退致死循环；越界读会拿到垃圾——两者都直接判非法。
      if (slen < 1 || pos + slen > bytes.length) throw new Error(`BSON 字符串长度 ${slen} 非法/越界`);
      field.value = new TextDecoder("utf-8", { fatal: false }).decode(bytes.slice(pos, pos + slen - 1)); pos += slen;
    } else if (type === 0x03) { // document
      const sub = bsonParseDocument(bytes, pos, depth + 1, maxDepth); pos = sub.pos;
      field.value = sub.fields; field.nested = true;
    } else if (type === 0x04) { // array
      const sub = bsonParseDocument(bytes, pos, depth + 1, maxDepth); pos = sub.pos;
      field.value = sub.fields; field.nested = true; field.isArray = true;
    } else if (type === 0x05) { // binary
      const blen = (bytes[pos] | (bytes[pos + 1] << 8) | (bytes[pos + 2] << 16) | (bytes[pos + 3] << 24)) | 0; pos += 4;
      if (blen < 0 || pos + 1 + blen > bytes.length) throw new Error(`BSON binary 长度 ${blen} 非法/越界`);
      const subtype = bytes[pos++];
      field.subtype = BSON_BIN_SUBTYPES[subtype] || `0x${subtype.toString(16)}`;
      field.value = bytes.slice(pos, pos + blen); pos += blen;
    } else if (type === 0x07) { // ObjectId
      field.value = bytesToHex(bytes.slice(pos, pos + 12)); pos += 12;
    } else if (type === 0x08) { // bool
      field.value = bytes[pos++] !== 0;
    } else if (type === 0x09) { // datetime (int64 ms)
      const dv = new DataView(new ArrayBuffer(8)); for (let i = 0; i < 8; i++) dv.setUint8(i, bytes[pos + i]); pos += 8;
      let ms = hasBigInt() ? dv.getBigInt64(0, true) : dv.getFloat64(0, true);
      field.value = `${ms} ms`;
    } else if (type === 0x0A) { // null
      field.value = null;
    } else if (type === 0x0B) { // regex
      const pat = readCString(bytes, pos); pos = pat.pos;
      const opt = readCString(bytes, pos); pos = opt.pos;
      field.value = `/${pat.value}/${opt.value}`;
    } else if (type === 0x10) { // int32
      field.value = (bytes[pos] | (bytes[pos + 1] << 8) | (bytes[pos + 2] << 16) | (bytes[pos + 3] << 24)) | 0; pos += 4;
    } else if (type === 0x11) { // timestamp
      const dv = new DataView(new ArrayBuffer(8)); for (let i = 0; i < 8; i++) dv.setUint8(i, bytes[pos + i]); pos += 8;
      const inc = dv.getUint32(0, true); const t = dv.getUint32(4, true);
      field.value = `T:${t} I:${inc}`;
    } else if (type === 0x12) { // int64
      const dv = new DataView(new ArrayBuffer(8)); for (let i = 0; i < 8; i++) dv.setUint8(i, bytes[pos + i]); pos += 8;
      field.value = hasBigInt() ? dv.getBigInt64(0, true).toString() : dv.getFloat64(0, true);
    } else if (type === 0xFF || type === 0x7F) { // minKey/maxKey
      field.value = type === 0xFF ? "minKey" : "maxKey";
    } else {
      throw new Error(`BSON 类型 0x${type.toString(16)} 未实现`);
    }
    fields.push(field);
  }
  return { fields, pos };
}

function formatBson(fields, indent = "") {
  const lines = [];
  for (const f of fields) {
    let valStr;
    if (f.value === null) valStr = "null";
    else if (typeof f.value === "boolean") valStr = String(f.value);
    else if (typeof f.value === "string") valStr = `"${f.value}"`;
    else if (typeof f.value === "number" || typeof f.value === "bigint") valStr = String(f.value);
    else if (f.value instanceof Uint8Array) valStr = `bin[${f.value.length}](${f.subtype || "?"}): ${bytesToHex(f.value, 32)}`;
    else if (f.nested) valStr = f.isArray ? `[${f.value.length} items]` : `{${f.value.length} fields}`;
    else valStr = String(f.value);
    lines.push(`${indent}"${f.name}" (${f.typeName}): ${valStr}`);
    if (f.nested) lines.push(...formatBson(f.value, indent + "  "));
  }
  return lines;
}

function bsonParseRun(text, p) {
  const bytes = (p && p.rawBytes && p.rawBytes.length)
    ? (p.rawBytes instanceof Uint8Array ? p.rawBytes : new Uint8Array(p.rawBytes))
    : inputToBytes(text, p);
  if (bytes.length === 0) return "请输入 BSON 二进制数据（hex 或 base64）";
  const lines = ["=== BSON 文档解析 ===", `输入: ${bytes.length} 字节`, ""];
  try {
    const r = bsonParseDocument(bytes, 0);
    lines.push(...formatBson(r.fields));
    if (r.pos < bytes.length) { lines.push(""); lines.push(`⚠ 仅消费 ${r.pos}/${bytes.length} 字节`); }
  } catch (e) { lines.push(`⚠ 解析失败: ${e.message}`); }
  return lines.join("\n");
}

// ============ PHP serialize 解析 ============
function phpSerializeParse(text, pos = 0, depth = 0, maxDepth = 128) {
  if (depth > maxDepth) throw new Error("嵌套深度超限");
  const s = text;
  const skipWs = (p) => { while (p < s.length && /\s/.test(s[p])) p++; return p; };
  pos = skipWs(pos);
  if (pos >= s.length) throw new Error("PHP serialize: 输入结束");
  const t = s[pos];
  if (t === "N") { // null
    if (s[pos + 1] !== ";") throw new Error("PHP N; 格式错");
    return { value: null, pos: pos + 2, type: "null" };
  }
  if (t === "b") { // bool
    if (s[pos + 1] !== ":") throw new Error("PHP b: 格式错");
    const v = s[pos + 2];
    if (s[pos + 3] !== ";") throw new Error("PHP b:x; 格式错");
    return { value: v === "1", pos: pos + 4, type: "bool" };
  }
  if (t === "i") { // int
    if (s[pos + 1] !== ":") throw new Error("PHP i: 格式错");
    let i = pos + 2; let num = "";
    while (i < s.length && s[i] !== ";") { num += s[i]; i++; }
    if (s[i] !== ";") throw new Error("PHP i:N; 缺 ;");
    return { value: parseInt(num, 10), pos: i + 1, type: "int" };
  }
  if (t === "d") { // float
    if (s[pos + 1] !== ":") throw new Error("PHP d: 格式错");
    let i = pos + 2; let num = "";
    while (i < s.length && s[i] !== ";") { num += s[i]; i++; }
    if (s[i] !== ";") throw new Error("PHP d:N; 缺 ;");
    return { value: parseFloat(num), pos: i + 1, type: "float" };
  }
  if (t === "s") { // string: s:LEN:"VAL";
    if (s[pos + 1] !== ":") throw new Error("PHP s: 格式错");
    let i = pos + 2; let lenStr = "";
    while (i < s.length && s[i] !== ":") { lenStr += s[i]; i++; }
    if (s[i] !== ":") throw new Error("PHP s:LEN: 缺 :");
    i++; // skip :
    const len = parseInt(lenStr, 10);
    if (isNaN(len) || len < 0) throw new Error(`PHP string 长度非法: ${lenStr}`);
    if (s[i] !== '"') throw new Error('PHP s:LEN:" 缺 "');
    i++; // skip opening "
 // LEN 是字节长度，但 JS 字符串是 UTF-16。这里按字符处理（CTF 场景多为 ASCII）。
 // 对含多字节字符的情况，用字节长度切分。
    const startIdx = i;
 // 简化：按字符数 = len 切（ASCII 场景正确；多字节需字节级处理，此处尽力而为）
    const val = s.substr(i, len);
    i += len;
    if (s[i] !== '"') throw new Error('PHP s:LEN:"VAL" 缺闭合 "');
    i++; // skip closing "
    if (s[i] !== ";") throw new Error('PHP s:LEN:"VAL"; 缺 ;');
    i++;
    return { value: val, pos: i, type: "string", length: len };
  }
  if (t === "a") { // array: a:LEN:{ key;val;key;val;... }
    if (s[pos + 1] !== ":") throw new Error("PHP a: 格式错");
    let i = pos + 2; let lenStr = "";
    while (i < s.length && s[i] !== ":") { lenStr += s[i]; i++; }
    if (s[i] !== ":") throw new Error("PHP a:LEN: 缺 :");
    i++;
    const len = parseInt(lenStr, 10);
    if (s[i] !== "{") throw new Error("PHP a:LEN:{ 缺 {");
    i++;
    const entries = [];
    for (let k = 0; k < len; k++) {
      const key = phpSerializeParse(s, i, depth + 1, maxDepth); i = key.pos;
      const val = phpSerializeParse(s, i, depth + 1, maxDepth); i = val.pos;
      entries.push({ key: key.value, value: val.value, keyType: key.type, valueType: val.type });
    }
    i = skipWs(i);
    if (s[i] !== "}") throw new Error("PHP a:LEN:{... 缺 }");
    i++;
    return { value: entries, pos: i, type: "array", count: len };
  }
  if (t === "O") { // object: O:LEN:"Name":N:{ prop;prop;... }
    if (s[pos + 1] !== ":") throw new Error("PHP O: 格式错");
    let i = pos + 2; let nameLenStr = "";
    while (i < s.length && s[i] !== ":") { nameLenStr += s[i]; i++; }
    if (s[i] !== ":") throw new Error("PHP O:LEN: 缺 :");
    i++;
    const nameLen = parseInt(nameLenStr, 10);
    if (s[i] !== '"') throw new Error('PHP O:LEN:" 缺 "');
    i++;
    const className = s.substr(i, nameLen);
    i += nameLen;
    if (s[i] !== '"') throw new Error('PHP O:LEN:"Name" 缺闭合 "');
    i++;
    if (s[i] !== ":") throw new Error('PHP O:LEN:"Name": 缺 :');
    i++;
    let propCountStr = "";
    while (i < s.length && s[i] !== ":") { propCountStr += s[i]; i++; }
    if (s[i] !== ":") throw new Error('PHP O:LEN:"Name":N: 缺 :');
    i++;
    const propCount = parseInt(propCountStr, 10);
    if (s[i] !== "{") throw new Error("PHP O:...:{ 缺 {");
    i++;
    const props = [];
    for (let k = 0; k < propCount; k++) {
      const key = phpSerializeParse(s, i, depth + 1, maxDepth); i = key.pos;
      const val = phpSerializeParse(s, i, depth + 1, maxDepth); i = val.pos;
      props.push({ key: key.value, value: val.value, keyType: key.type, valueType: val.type });
    }
    i = skipWs(i);
    if (s[i] !== "}") throw new Error("PHP O:...:{... 缺 }");
    i++;
    return { value: props, pos: i, type: "object", className, count: propCount };
  }
  if (t === "C") { // serializable: C:"Name":LEN:{DATA}
    if (s[pos + 1] !== ":") throw new Error("PHP C: 格式错");
    let i = pos + 2; let nameLenStr = "";
    while (i < s.length && s[i] !== ":") { nameLenStr += s[i]; i++; }
    i++;
    const nameLen = parseInt(nameLenStr, 10);
    if (s[i] !== '"') throw new Error('PHP C:" 缺 "');
    i++;
    const className = s.substr(i, nameLen); i += nameLen;
    if (s[i] !== '"') throw new Error('PHP C:"Name" 缺 "'); i++;
    if (s[i] !== ":") throw new Error('PHP C:...: 缺 :'); i++;
    let dataLenStr = ""; while (i < s.length && s[i] !== ":") { dataLenStr += s[i]; i++; }
    i++;
    const dataLen = parseInt(dataLenStr, 10);
    if (s[i] !== "{") throw new Error("PHP C:...:{ 缺 {"); i++;
    const data = s.substr(i, dataLen); i += dataLen;
    if (s[i] !== "}") throw new Error("PHP C:...:{... 缺 }"); i++;
    return { value: data, pos: i, type: "serializable", className, length: dataLen };
  }
  if (t === "r" || t === "R") { // reference
    if (s[pos + 1] !== ":") throw new Error("PHP r: 格式错");
    let i = pos + 2; let numStr = "";
    while (i < s.length && s[i] !== ";") { numStr += s[i]; i++; }
    if (s[i] !== ";") throw new Error("PHP r:N; 缺 ;");
    return { value: parseInt(numStr, 10), pos: i + 1, type: t === "r" ? "ref" : "refObj" };
  }
  throw new Error(`PHP serialize 未知类型 '${t}' @pos=${pos}`);
}

function formatPhp(node, indent = "") {
  const lines = [];
  const v = node.value, t = node.type;
  if (t === "null") lines.push(`${indent}null`);
  else if (t === "bool") lines.push(`${indent}bool: ${v}`);
  else if (t === "int") lines.push(`${indent}int: ${v}`);
  else if (t === "float") lines.push(`${indent}float: ${v}`);
  else if (t === "string") lines.push(`${indent}string[${node.length}]: "${v}"`);
  else if (t === "array") { lines.push(`${indent}array[${node.count}]:`); for (const e of v) { lines.push(`${indent}  [${e.key}] (${e.keyType}):`); lines.push(...formatPhp({ value: e.value, type: e.valueType }, indent + "    ")); } }
  else if (t === "object") { lines.push(`${indent}object(${node.className})[${node.count}]:`); for (const e of v) { lines.push(`${indent}  ${e.key} (${e.keyType}):`); lines.push(...formatPhp({ value: e.value, type: e.valueType }, indent + "    ")); } }
  else if (t === "serializable") lines.push(`${indent}serializable(${node.className})[${node.length}]: "${v}"`);
  else if (t === "ref") lines.push(`${indent}&${v} (reference)`);
  else if (t === "refObj") lines.push(`${indent}&${v} (object reference)`);
  return lines;
}

function phpSerializeParseRun(text) {
  const s = String(text).trim();
  if (!s) return "请输入 PHP serialize() 字符串";
  const lines = ["=== PHP serialize 解析 ===", `输入: ${s.length} 字符`, ""];
  try {
    const r = phpSerializeParse(s, 0);
    lines.push(...formatPhp(r));
    if (r.pos < s.length) { lines.push(""); lines.push(`⚠ 仅消费 ${r.pos}/${s.length} 字符，剩余: "${s.slice(r.pos, r.pos + 40)}"`); }
  } catch (e) { lines.push(`⚠ 解析失败: ${e.message}`); }
  return lines.join("\n");
}

// ============ Java 序列化识别 ============
const JAVA_TC = {
  0x70: "TC_NULL", 0x71: "TC_REFERENCE", 0x72: "TC_CLASSDESC",
  0x73: "TC_OBJECT", 0x74: "TC_STRING", 0x75: "TC_ARRAY",
  0x76: "TC_CLASS", 0x77: "TC_BLOCKDATA", 0x78: "TC_ENDBLOCKDATA",
  0x79: "TC_RESET", 0x7A: "TC_BLOCKDATALONG", 0x7B: "TC_EXCEPTION",
  0x7C: "TC_LONGSTRING", 0x7D: "TC_PROXYCLASSDESC", 0x7E: "TC_ENUM",
};
const JAVA_BASE_WIRE_HANDLE = 0x7E0000;

function javaSerializeIdentRun(text, p) {
  const bytes = (p && p.rawBytes && p.rawBytes.length)
    ? (p.rawBytes instanceof Uint8Array ? p.rawBytes : new Uint8Array(p.rawBytes))
    : inputToBytes(text, p);
  if (bytes.length === 0) return "请输入 Java 序列化二进制数据（hex 或 base64）";
  const lines = ["=== Java 序列化识别 ===", `输入: ${bytes.length} 字节`, ""];

 // magic 0xACED + version 0x0005
  if (bytes.length < 4) { lines.push("⚠ 输入不足 4 字节，无法识别 Java magic"); return lines.join("\n"); }
  const magic = (bytes[0] << 8) | bytes[1];
  const version = (bytes[2] << 8) | bytes[3];
  if (magic !== 0xACED) {
    lines.push(`⚠ magic 不匹配: 期望 0xACED，得到 0x${magic.toString(16).toUpperCase()}`);
    lines.push("  （Java 序列化流必须以 0xACED 0x0005 开头）");
    return lines.join("\n");
  }
  lines.push(`✓ Magic: 0xACED (Java Object Serialization)`);
  lines.push(`✓ Version: 0x${version.toString(16).toUpperCase()}${version === 5 ? " (正确)" : " (非标准，期望 0x0005)"}`);
  lines.push("");

 // 顶层结构扫描
  let pos = 4;
  const handles = [];
  const blockLines = [];
  try {
    while (pos < bytes.length) {
      const tc = bytes[pos];
      const tcName = JAVA_TC[tc] || `0x${tc.toString(16).padStart(2, "0")}`;
      if (tc === 0x78) { // TC_ENDBLOCKDATA
        pos++;
        blockLines.push(`  @${pos - 1}: TC_ENDBLOCKDATA`);
        continue;
      }
      if (tc === 0x70) { // TC_NULL
        pos++;
        handles.push({ type: "null" });
        blockLines.push(`  @${pos - 1}: TC_NULL`);
        continue;
      }
      if (tc === 0x74) { // TC_STRING
        pos++;
        const len = (bytes[pos] << 8) | bytes[pos + 1]; pos += 2;
        const str = new TextDecoder("utf-8", { fatal: false }).decode(bytes.slice(pos, pos + len));
        pos += len;
        handles.push({ type: "string", value: str });
        blockLines.push(`  @${pos - len - 3}: TC_STRING (handle #${handles.length - 1}): "${str}"`);
        continue;
      }
      if (tc === 0x7C) { // TC_LONGSTRING
        pos++;
        const hi = ((bytes[pos] << 24) | (bytes[pos + 1] << 16) | (bytes[pos + 2] << 8) | bytes[pos + 3]) >>> 0; pos += 4;
        const lo = ((bytes[pos] << 24) | (bytes[pos + 1] << 16) | (bytes[pos + 2] << 8) | bytes[pos + 3]) >>> 0; pos += 4;
        const len = hasBigInt() ? (BigInt(hi) << 32n | BigInt(lo)) : (hi * 0x100000000 + lo);
        const str = new TextDecoder("utf-8", { fatal: false }).decode(bytes.slice(pos, pos + Number(len)));
        pos += Number(len);
        handles.push({ type: "longstring", value: str });
        blockLines.push(`  @${pos - Number(len) - 9}: TC_LONGSTRING (handle #${handles.length - 1}): "${str}"`);
        continue;
      }
      if (tc === 0x72) { // TC_CLASSDESC
        pos++;
        const start = pos - 1;
 // className: UTF (2 byte len + bytes)
        const nameLen = (bytes[pos] << 8) | bytes[pos + 1]; pos += 2;
        const className = new TextDecoder("utf-8", { fatal: false }).decode(bytes.slice(pos, pos + nameLen));
        pos += nameLen;
 // serialVersionUID: 8 bytes
        const suid = bytesToHex(bytes.slice(pos, pos + 8)); pos += 8;
 // classDescFlags: 1 byte
        const flags = bytes[pos++];
        const flagStr = [];
        if (flags & 0x01) flagStr.push("SC_WRITE_METHOD");
        if (flags & 0x02) flagStr.push("SC_BLOCK_DATA");
        if (flags & 0x04) flagStr.push("SC_SERIALIZABLE");
        if (flags & 0x08) flagStr.push("SC_EXTERNALIZABLE");
        if (flags & 0x10) flagStr.push("SC_ENUM");
 // fields: count (2 byte) + field descriptors
        const fieldCount = (bytes[pos] << 8) | bytes[pos + 1]; pos += 2;
        const fields = [];
        for (let i = 0; i < fieldCount; i++) {
          const ftype = String.fromCharCode(bytes[pos++]);
          const fnameLen = (bytes[pos] << 8) | bytes[pos + 1]; pos += 2;
          const fname = new TextDecoder("utf-8", { fatal: false }).decode(bytes.slice(pos, pos + fnameLen));
          pos += fnameLen;
          let className2 = "";
          if (ftype === "L" || ftype === "[") {
 // object field: TC_STRING / TC_LONGSTRING / TC_REFERENCE
            const ref = bytes[pos++];
            if (ref === 0x74) { // TC_STRING
              const slen = (bytes[pos] << 8) | bytes[pos + 1]; pos += 2;
              className2 = new TextDecoder("utf-8", { fatal: false }).decode(bytes.slice(pos, pos + slen));
              pos += slen;
            } else if (ref === 0x71) { // TC_REFERENCE
              pos += 4; // handle
            }
          }
          fields.push({ type: ftype, name: fname, className: className2 });
        }
 // classAnnotation: TC_ENDBLOCKDATA (or block data)
 // 跳过 annotation
 // 这里简单跳过到 TC_ENDBLOCKDATA
 // superClassDesc: 递归
        handles.push({ type: "classdesc", className, suid, flags: flagStr.join("|"), fields });
        blockLines.push(`  @${start}: TC_CLASSDESC (handle #${handles.length - 1}):`);
        blockLines.push(`    className: ${className}`);
        blockLines.push(`    serialVersionUID: ${suid}`);
        blockLines.push(`    flags: ${flagStr.join(" | ") || "(none)"}`);
        blockLines.push(`    fields (${fieldCount}):`);
        for (const f of fields) {
          blockLines.push(`      ${f.type} ${f.name}${f.className ? ` : ${f.className}` : ""}`);
        }
        continue;
      }
      if (tc === 0x73) { // TC_OBJECT
        pos++;
        const start = pos - 1;
        blockLines.push(`  @${start}: TC_OBJECT`);
 // classDesc follows, then data
        continue;
      }
      if (tc === 0x77) { // TC_BLOCKDATA
        pos++;
        const len = bytes[pos++];
        const data = bytes.slice(pos, pos + len); pos += len;
        blockLines.push(`  @${pos - len - 2}: TC_BLOCKDATA (${len} bytes): ${bytesToHex(data, 32)}`);
        continue;
      }
      if (tc === 0x7A) { // TC_BLOCKDATALONG
        pos++;
        const len = ((bytes[pos] << 24) | (bytes[pos + 1] << 16) | (bytes[pos + 2] << 8) | bytes[pos + 3]) >>> 0; pos += 4;
        const data = bytes.slice(pos, pos + len); pos += len;
        blockLines.push(`  @${pos - len - 5}: TC_BLOCKDATALONG (${len} bytes): ${bytesToHex(data, 32)}`);
        continue;
      }
      if (tc === 0x71) { // TC_REFERENCE
        pos++;
        const handle = ((bytes[pos] << 24) | (bytes[pos + 1] << 16) | (bytes[pos + 2] << 8) | bytes[pos + 3]) >>> 0; pos += 4;
        blockLines.push(`  @${pos - 5}: TC_REFERENCE → handle 0x${handle.toString(16).toUpperCase()} (#${handle - JAVA_BASE_WIRE_HANDLE})`);
        continue;
      }
      if (tc === 0x79) { // TC_RESET
        pos++;
        blockLines.push(`  @${pos - 1}: TC_RESET`);
        continue;
      }
 // 未识别/未深入处理
      blockLines.push(`  @${pos}: ${tcName} (未深入解析)`);
      pos++;
    }
  } catch (e) {
    blockLines.push(`  ⚠ 扫描中断 @pos=${pos}: ${e.message}`);
  }

  lines.push("--- 顶层结构 ---");
  if (blockLines.length === 0) lines.push("  （无顶层内容标记）");
  else lines.push(...blockLines);
  lines.push("");
  lines.push(`句柄数: ${handles.length}`);
  lines.push("说明: 完整 Java 序列化解析复杂，此处识别 magic + 扫描顶层 TC_* 标记（TC_STRING/TC_CLASSDESC/TC_BLOCKDATA 等提取关键信息）。");
  return lines.join("\n");
}

// ============ 注册 ============
register({
  id: "protobufParse", cat: "data", name: "Protobuf Wire 解析",
  desc: "无 schema 解析 protobuf wire 格式（varint/64-bit/length-delimited/32-bit，自动尝试嵌套 message 与字符串）",
  params: [INPUT_ENC_PARAM],
  run: protobufParseRun,
  acceptsBytes: true,
});
register({
  id: "msgpackParse", cat: "data", name: "MessagePack 解析",
  desc: "解析 MessagePack 二进制（全类型：nil/bool/int/float/str/bin/array/map/ext）",
  params: [INPUT_ENC_PARAM],
  run: msgpackParseRun,
  acceptsBytes: true,
});
register({
  id: "cborParse", cat: "data", name: "CBOR 解析",
  desc: "解析 CBOR 二进制（RFC 8949，含 major type 0-7、indefinite length、tag、half/float）",
  params: [INPUT_ENC_PARAM],
  run: cborParseRun,
  acceptsBytes: true,
});
register({
  id: "bsonParse", cat: "data", name: "BSON 文档解析",
  desc: "解析 BSON 文档（bsonspec.org：double/string/document/array/binary/ObjectId/bool/datetime/null/int32/int64 等）",
  params: [INPUT_ENC_PARAM],
  run: bsonParseRun,
  acceptsBytes: true,
});
register({
  id: "phpSerializeParse", cat: "data", name: "PHP serialize 解析",
  desc: "解析 PHP serialize() 字符串（N/b/i/d/s/a/O/C/r/R 全类型，递归嵌套）",
  params: [],
  run: phpSerializeParseRun,
});
register({
  id: "javaSerializeIdent", cat: "data", name: "Java 序列化识别",
  desc: "识别 Java Object Serialization magic(0xACED) + 扫描顶层 TC_* 标记（TC_STRING/TC_CLASSDESC/TC_BLOCKDATA 等关键信息）",
  params: [INPUT_ENC_PARAM],
  run: javaSerializeIdentRun,
  acceptsBytes: true,
});

export {
  protobufParseFields, msgpackParse, cborParse, bsonParseDocument,
  phpSerializeParse, readVarint, cborReadHead,
};
