/*
 * serialEnc.js — 序列化格式「出站编码」组（cat:'data'），CyberChef 全量对齐 P0-3。
 *
 * 与 serial.js 的解析方向互补：serial.js 是 binary→报告，本模块是 JSON 文本→binary。
 * 覆盖（全部 run 单向，输入 JSON 文本，输出 hex/base64）：
 * - cborEncode            CBOR 编码（RFC 8949：null/bool/uint/negint/float/string/array/map）
 * - msgpackEncode         MessagePack 编码（nil/bool/int/float/str/bin/array/map）
 * - bsonSerialize         BSON 文档序列化（document/array/string/int32/int64/double/bool/null）
 * - phpSerializeGenerate  PHP serialize() 生成（N/b/i/d/s/a；数组区分 list/map 最小实现）
 * - protobufEncode        Protobuf 编码（简化 .proto schema：message + 标量字段 + repeated 可选）
 *
 * 算法标准（照公开规范实现，不编造）：
 * - CBOR: RFC 8949
 * - MessagePack: https://github.com/msgpack/msgpack/blob/master/spec.md
 * - BSON: http://bsonspec.org/spec.html
 * - PHP serialize: https://www.php.net/manual/en/function.serialize.php
 * - Protobuf: https://protobuf.dev/programming-guides/encoding/
 *
 * 未实现（明确，不伪造）：
 * - CBOR：indefinite length（不定长）、tag、half/single float（本实现浮点一律 float64）
 * - BSON：ObjectId / datetime / binary / regex / decimal128 等非最小集合类型
 * - Protobuf：map / oneof / 嵌套 message / packed repeated / 枚举（仅标量 + repeated）
 * - PHP：O/C/r/R（对象/自定义序列化/引用）不出站，仅 N/b/i/d/s/a
 *
 * 本模块只 import registry.js（register）与 bytesIo.js（hex/base64），纯 JS 零依赖。
 * 共享入口（registerAll.js）由 M 接线，本文件不自行改注册表。
 */
import { register } from "./registry.js";
import { bytesToHex, bytesToB64, b64ToBytes } from "./bytesIo.js";

const TE = new TextEncoder();
const TD = new TextDecoder("utf-8");

/** 取视图真字节通道（params.rawBytes）；无则 null。 */
function rawBytesOf(p) {
  const b = p && p.rawBytes;
  if (b == null) return null;
  return b instanceof Uint8Array ? b : new Uint8Array(b);
}

/** 视图 text 模式字节与文本同构时让位给原文本层；真字节（hex/base64 视图、文件）原样优先。 */
function rawBytesOrNull(p, text) {
  const b = rawBytesOf(p);
  if (!b) return null;
  const t = new TextEncoder().encode(String(text == null ? "" : text));
  if (b.length === t.length) {
    let same = true;
    for (let i = 0; i < b.length; i++) if (b[i] !== t[i]) { same = false; break; }
    if (same) return null;
  }
  return b;
}

/** 主输入：视图真字节优先（按 UTF-8 还原 JSON 文本），否则原文本路径。 */
function inputText(p, text) {
  const b = rawBytesOrNull(p, text);
  return b ? TD.decode(b) : String(text == null ? "" : text);
}

// ============ 通用字节工具 ============
class Buf {
  constructor() { this.parts = []; this.length = 0; }
  u8(...v) { this.parts.push(Uint8Array.from(v)); this.length += v.length; return this; }
  bytes(b) { this.parts.push(b); this.length += b.length; return this; }
  out() {
    const r = new Uint8Array(this.length);
    let o = 0;
    for (const p of this.parts) { r.set(p, o); o += p.length; }
    return r;
  }
}
const u8 = (...v) => Uint8Array.from(v);

function f64be(v) { const t = new Uint8Array(8); new DataView(t.buffer).setFloat64(0, v, false); return t; }
function f64le(v) { const t = new Uint8Array(8); new DataView(t.buffer).setFloat64(0, v, true); return t; }

function outBytes(bytes, p) {
  const e = String((p && p.outEnc) || "hex").toLowerCase();
  if (e === "base64") return bytesToB64(bytes);
  return bytesToHex(bytes);
}

function parseJsonInput(text) {
  const s = String(text == null ? "" : text).trim();
  if (!s) throw new Error("请输入 JSON 文本");
  let v;
  try { v = JSON.parse(s); } catch (e) { throw new Error("JSON 解析失败：" + e.message); }
  return v;
}

const OUT_ENC_PARAM = {
  key: "outEnc", label: "输出编码", type: "select", default: "hex",
  options: [
    { value: "hex", label: "Hex" },
    { value: "base64", label: "Base64" },
  ],
};

// ============ CBOR 编码（RFC 8949） ============
function cborHead(mt, n) {
  let v = typeof n === "bigint" ? n : BigInt(n);
  if (v < 0n) throw new Error("CBOR 头部长度不能为负");
  const b = new Buf();
  if (v < 24n) b.u8((mt << 5) | Number(v));
  else if (v <= 0xffn) b.u8((mt << 5) | 24, Number(v));
  else if (v <= 0xffffn) { const t = new Uint8Array(2); new DataView(t.buffer).setUint16(0, Number(v), false); b.u8((mt << 5) | 25).bytes(t); }
  else if (v <= 0xffffffffn) { const t = new Uint8Array(4); new DataView(t.buffer).setUint32(0, Number(v), false); b.u8((mt << 5) | 26).bytes(t); }
  else { const t = new Uint8Array(8); new DataView(t.buffer).setBigUint64(0, v, false); b.u8((mt << 5) | 27).bytes(t); }
  return b.out();
}

function cborEncode(value, depth = 0) {
  if (depth > 256) throw new Error("CBOR 嵌套深度超限");
  if (value === null) return u8(0xf6);
  if (value === undefined) throw new Error("CBOR 不支持 undefined（JSON 无此类型）");
  if (typeof value === "boolean") return u8(value ? 0xf5 : 0xf4);
  if (typeof value === "bigint") {
    if (value >= 0n) return cborHead(0, value);
    return cborHead(1, -1n - value);
  }
  if (typeof value === "number") {
    if (Number.isInteger(value) && Number.isSafeInteger(value)) {
      return value >= 0 ? cborHead(0, value) : cborHead(1, -1 - value);
    }
    const b = new Buf(); b.u8(0xfb).bytes(f64be(value)); return b.out();
  }
  if (typeof value === "string") {
    const s = TE.encode(value);
    const b = new Buf(); b.bytes(cborHead(3, s.length)).bytes(s); return b.out();
  }
  if (value instanceof Uint8Array) {
    const b = new Buf(); b.bytes(cborHead(2, value.length)).bytes(value); return b.out();
  }
  if (Array.isArray(value)) {
    const b = new Buf(); b.bytes(cborHead(4, value.length));
    for (const it of value) b.bytes(cborEncode(it, depth + 1));
    return b.out();
  }
  if (typeof value === "object") {
    const keys = Object.keys(value);
    const b = new Buf(); b.bytes(cborHead(5, keys.length));
    for (const k of keys) { b.bytes(cborEncode(k, depth + 1)); b.bytes(cborEncode(value[k], depth + 1)); }
    return b.out();
  }
  throw new Error("CBOR 不支持的类型: " + typeof value);
}

function cborEncodeRun(text, p = {}) { return outBytes(cborEncode(parseJsonInput(inputText(p, text))), p); }

// ============ MessagePack 编码 ============
function mpInt(value) {
  const b = new Buf();
  const v = typeof value === "bigint" ? value : BigInt(value);
  if (v >= 0n) {
    if (v <= 0x7fn) b.u8(Number(v));
    else if (v <= 0xffn) b.u8(0xcc, Number(v));
    else if (v <= 0xffffn) { const t = new Uint8Array(2); new DataView(t.buffer).setUint16(0, Number(v), false); b.u8(0xcd).bytes(t); }
    else if (v <= 0xffffffffn) { const t = new Uint8Array(4); new DataView(t.buffer).setUint32(0, Number(v), false); b.u8(0xce).bytes(t); }
    else { const t = new Uint8Array(8); new DataView(t.buffer).setBigUint64(0, v, false); b.u8(0xcf).bytes(t); }
  } else {
    if (v >= -32n) b.u8(Number(v & 0xffn));
    else if (v >= -128n) b.u8(0xd0, Number(v & 0xffn));
    else if (v >= -32768n) { const t = new Uint8Array(2); new DataView(t.buffer).setInt16(0, Number(v), false); b.u8(0xd1).bytes(t); }
    else if (v >= -2147483648n) { const t = new Uint8Array(4); new DataView(t.buffer).setInt32(0, Number(v), false); b.u8(0xd2).bytes(t); }
    else { const t = new Uint8Array(8); new DataView(t.buffer).setBigInt64(0, v, false); b.u8(0xd3).bytes(t); }
  }
  return b.out();
}

function msgpackEncode(value, depth = 0) {
  if (depth > 256) throw new Error("MessagePack 嵌套深度超限");
  if (value === null || value === undefined) return u8(0xc0);
  if (typeof value === "boolean") return u8(value ? 0xc3 : 0xc2);
  if (typeof value === "bigint") return mpInt(value);
  if (typeof value === "number") {
    if (Number.isInteger(value) && Number.isSafeInteger(value)) return mpInt(value);
    const b = new Buf(); b.u8(0xcb).bytes(f64be(value)); return b.out();
  }
  if (typeof value === "string") {
    const s = TE.encode(value), n = s.length;
    const b = new Buf();
    if (n <= 31) b.u8(0xa0 | n);
    else if (n <= 0xff) b.u8(0xd9, n);
    else if (n <= 0xffff) { const t = new Uint8Array(2); new DataView(t.buffer).setUint16(0, n, false); b.u8(0xda).bytes(t); }
    else { const t = new Uint8Array(4); new DataView(t.buffer).setUint32(0, n, false); b.u8(0xdb).bytes(t); }
    b.bytes(s); return b.out();
  }
  if (value instanceof Uint8Array) {
    const n = value.length;
    const b = new Buf();
    if (n <= 0xff) b.u8(0xc4, n);
    else if (n <= 0xffff) { const t = new Uint8Array(2); new DataView(t.buffer).setUint16(0, n, false); b.u8(0xc5).bytes(t); }
    else { const t = new Uint8Array(4); new DataView(t.buffer).setUint32(0, n, false); b.u8(0xc6).bytes(t); }
    b.bytes(value); return b.out();
  }
  if (Array.isArray(value)) {
    const n = value.length;
    const b = new Buf();
    if (n <= 15) b.u8(0x90 | n);
    else if (n <= 0xffff) { const t = new Uint8Array(2); new DataView(t.buffer).setUint16(0, n, false); b.u8(0xdc).bytes(t); }
    else { const t = new Uint8Array(4); new DataView(t.buffer).setUint32(0, n, false); b.u8(0xdd).bytes(t); }
    for (const it of value) b.bytes(msgpackEncode(it, depth + 1));
    return b.out();
  }
  if (typeof value === "object") {
    const keys = Object.keys(value), n = keys.length;
    const b = new Buf();
    if (n <= 15) b.u8(0x80 | n);
    else if (n <= 0xffff) { const t = new Uint8Array(2); new DataView(t.buffer).setUint16(0, n, false); b.u8(0xde).bytes(t); }
    else { const t = new Uint8Array(4); new DataView(t.buffer).setUint32(0, n, false); b.u8(0xdf).bytes(t); }
    for (const k of keys) { b.bytes(msgpackEncode(k, depth + 1)); b.bytes(msgpackEncode(value[k], depth + 1)); }
    return b.out();
  }
  throw new Error("MessagePack 不支持的类型: " + typeof value);
}

function msgpackEncodeRun(text, p = {}) { return outBytes(msgpackEncode(parseJsonInput(inputText(p, text))), p); }

// ============ BSON 序列化（bsonspec.org） ============
function i32le(v) { const t = new Uint8Array(4); new DataView(t.buffer).setInt32(0, v, true); return t; }
function i64le(v) { const t = new Uint8Array(8); new DataView(t.buffer).setBigInt64(0, v, true); return t; }

function bsonCString(str) {
  const s = TE.encode(String(str));
  for (const c of s) if (c === 0) throw new Error("BSON 键名不能含 NUL 字节");
  return new Buf().bytes(s).u8(0).out();
}

function bsonElement(key, value, depth) {
  const name = bsonCString(key);
  const b = new Buf();
  if (value === null) { b.u8(0x0a).bytes(name); return b.out(); }
  if (typeof value === "boolean") { b.u8(0x08).bytes(name).u8(value ? 1 : 0); return b.out(); }
  if (typeof value === "string") {
    const s = TE.encode(value);
    b.u8(0x02).bytes(name).bytes(i32le(s.length + 1)).bytes(s).u8(0); return b.out();
  }
  if (typeof value === "bigint") { b.u8(0x12).bytes(name).bytes(i64le(value)); return b.out(); }
  if (typeof value === "number") {
    if (Number.isInteger(value) && value >= -2147483648 && value <= 2147483647) b.u8(0x10).bytes(name).bytes(i32le(value));
    else if (Number.isInteger(value) && Number.isSafeInteger(value)) b.u8(0x12).bytes(name).bytes(i64le(BigInt(value)));
    else b.u8(0x01).bytes(name).bytes(f64le(value));
    return b.out();
  }
  if (Array.isArray(value)) { b.u8(0x04).bytes(name).bytes(bsonSerializeDocument(value, depth + 1)); return b.out(); }
  if (typeof value === "object") { b.u8(0x03).bytes(name).bytes(bsonSerializeDocument(value, depth + 1)); return b.out(); }
  throw new Error("BSON 不支持的值类型: " + typeof value);
}

function bsonSerializeDocument(obj, depth = 0) {
  if (depth > 64) throw new Error("BSON 嵌套深度超限");
  const isArr = Array.isArray(obj);
  const body = new Buf();
  const keys = isArr ? obj.map((_, i) => String(i)) : Object.keys(obj);
  for (const key of keys) body.bytes(bsonElement(key, isArr ? obj[Number(key)] : obj[key], depth));
  const payload = body.out();
  const out = new Buf();
  out.bytes(i32le(4 + payload.length + 1)).bytes(payload).u8(0);
  return out.out();
}

function bsonSerialize(value, depth = 0) {
  if (value === null || typeof value !== "object") throw new Error("BSON 顶层必须是 document（对象）或 array（数组）");
  return bsonSerializeDocument(value, depth);
}

function bsonSerializeRun(text, p = {}) { return outBytes(bsonSerialize(parseJsonInput(inputText(p, text))), p); }

// ============ PHP serialize 生成 ============
function phpFloat(v) {
  if (Number.isNaN(v)) return "NAN";
  if (v === Infinity) return "INF";
  if (v === -Infinity) return "-INF";
  return String(v);
}

function phpSerialize(value, depth = 0) {
  if (depth > 256) throw new Error("PHP serialize 嵌套深度超限");
  if (value === null) return "N;";
  if (typeof value === "boolean") return value ? "b:1;" : "b:0;";
  if (typeof value === "bigint") return "i:" + value.toString() + ";";
  if (typeof value === "number") return Number.isInteger(value) ? "i:" + value + ";" : "d:" + phpFloat(value) + ";";
  if (typeof value === "string") return `s:${TE.encode(value).length}:"${value}";`;
  if (Array.isArray(value)) {
    let s = "a:" + value.length + ":{";
    for (let i = 0; i < value.length; i++) s += "i:" + i + ";" + phpSerialize(value[i], depth + 1);
    return s + "}";
  }
  if (typeof value === "object") {
    const keys = Object.keys(value);
    let s = "a:" + keys.length + ":{";
    for (const k of keys) s += `s:${TE.encode(k).length}:"${k}";` + phpSerialize(value[k], depth + 1);
    return s + "}";
  }
  throw new Error("PHP serialize 不支持的类型: " + typeof value);
}

function phpSerializeRun(text) { return phpSerialize(parseJsonInput(text)); }

// ============ Protobuf 编码（简化 .proto schema） ============
const PROTO_TYPES = {
  int32: { wire: 0, kind: "int", signed: true, bits: 32 },
  int64: { wire: 0, kind: "int", signed: true, bits: 64 },
  uint32: { wire: 0, kind: "uint", bits: 32 },
  uint64: { wire: 0, kind: "uint", bits: 64 },
  sint32: { wire: 0, kind: "sint", bits: 32 },
  sint64: { wire: 0, kind: "sint", bits: 64 },
  bool: { wire: 0, kind: "bool" },
  fixed32: { wire: 5, kind: "fixed", signed: false, bits: 32 },
  fixed64: { wire: 1, kind: "fixed", signed: false, bits: 64 },
  sfixed32: { wire: 5, kind: "fixed", signed: true, bits: 32 },
  sfixed64: { wire: 1, kind: "fixed", signed: true, bits: 64 },
  float: { wire: 5, kind: "float" },
  double: { wire: 1, kind: "double" },
  string: { wire: 2, kind: "string" },
  bytes: { wire: 2, kind: "bytes" },
};

function parseProtoSchema(text) {
  const src = String(text || "").replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  const fields = [];
  const re = /(repeated\s+)?([A-Za-z_][\w.]*)\s+([A-Za-z_]\w*)\s*=\s*(\d+)\s*;/g;
  let m;
  while ((m = re.exec(src))) {
    const type = m[2];
    const def = PROTO_TYPES[type];
    if (!def) throw new Error(`Protobuf：不支持的字段类型 "${type}"（字段 ${m[3]}）`);
    const number = Number(m[4]);
    if (!Number.isInteger(number) || number <= 0 || number > 536870911) throw new Error("Protobuf：非法字段号 " + m[4]);
    fields.push({ name: m[3], number, type, repeated: !!m[1], ...def });
  }
  if (fields.length === 0) throw new Error("Protobuf：schema 未解析出字段（仅支持 message + 标量字段 [+ repeated]，不做 map/oneof）");
  return fields.sort((a, b) => a.number - b.number);
}

function protoVarint(n) {
  let x = BigInt.asUintN(64, typeof n === "bigint" ? n : BigInt(n));
  const b = new Buf();
  while (x > 0x7fn) { b.u8(Number(x & 0x7fn) | 0x80); x >>= 7n; }
  b.u8(Number(x));
  return b.out();
}

function zigzag64(v) { return v >= 0n ? v << 1n : ((-v) << 1n) - 1n; }

function toByteValue(value) {
  if (value instanceof Uint8Array) return value;
  if (Array.isArray(value)) return Uint8Array.from(value.map(Number));
  if (typeof value === "string") return b64ToBytes(value);
  throw new Error("Protobuf：bytes 字段值需为 base64 串 / 字节数组");
}

function protoEncodeValue(f, value) {
  const b = new Buf();
  if (f.kind === "int") {
    let v = BigInt(value);
    v = f.signed ? BigInt.asUintN(64, v) : BigInt.asUintN(f.bits, v);
    b.bytes(protoVarint(v));
  } else if (f.kind === "uint") {
    let v = BigInt(value);
    if (v < 0n) throw new Error("Protobuf：unsigned 字段不能为负");
    b.bytes(protoVarint(BigInt.asUintN(f.bits, v)));
  } else if (f.kind === "sint") {
    b.bytes(protoVarint(zigzag64(BigInt(value))));
  } else if (f.kind === "bool") {
    b.u8(value ? 1 : 0);
  } else if (f.kind === "fixed") {
    if (f.bits === 32) {
      const t = new Uint8Array(4), dv = new DataView(t.buffer);
      f.signed ? dv.setInt32(0, Number(value), true) : dv.setUint32(0, Number(value), true);
      b.bytes(t);
    } else {
      const t = new Uint8Array(8), dv = new DataView(t.buffer);
      const v = BigInt(value);
      f.signed ? dv.setBigInt64(0, v, true) : dv.setBigUint64(0, v, true);
      b.bytes(t);
    }
  } else if (f.kind === "float") {
    const t = new Uint8Array(4); new DataView(t.buffer).setFloat32(0, Number(value), true); b.bytes(t);
  } else if (f.kind === "double") {
    const t = new Uint8Array(8); new DataView(t.buffer).setFloat64(0, Number(value), true); b.bytes(t);
  } else if (f.kind === "string") {
    const s = TE.encode(String(value));
    b.bytes(protoVarint(s.length)).bytes(s);
  } else if (f.kind === "bytes") {
    const raw = toByteValue(value);
    b.bytes(protoVarint(raw.length)).bytes(raw);
  } else {
    throw new Error("Protobuf：未实现字段类型 " + f.type);
  }
  return b.out();
}

function protobufEncode(obj, schemaText) {
  const fields = parseProtoSchema(schemaText);
  if (obj === null || typeof obj !== "object" || Array.isArray(obj)) throw new Error("Protobuf：输入 JSON 必须是对象");
  const b = new Buf();
  for (const f of fields) {
    if (!(f.name in obj) || obj[f.name] === undefined) continue;
    const val = obj[f.name];
    const key = protoVarint(f.number * 8 + f.wire);
    if (f.repeated) {
      if (!Array.isArray(val)) throw new Error(`Protobuf：repeated 字段 ${f.name} 需要数组`);
      for (const item of val) b.bytes(key).bytes(protoEncodeValue(f, item));
    } else {
      b.bytes(key).bytes(protoEncodeValue(f, val));
    }
  }
  return b.out();
}

function protobufEncodeRun(text, p = {}) {
  const bytes = protobufEncode(parseJsonInput(inputText(p, text)), p.schema || "");
  return outBytes(bytes, p);
}

// ============ 注册 ============
register({
  id: "cborEncode", cat: "data", name: "CBOR 编码",
  acceptsBytes: true,
  desc: "JSON → CBOR 二进制（RFC 8949：null/bool/uint/negint/float/string/array/map；浮点一律 float64；不做 indefinite/tag）",
  params: [OUT_ENC_PARAM],
  run: cborEncodeRun,
});
register({
  id: "msgpackEncode", cat: "data", name: "MessagePack 编码",
  acceptsBytes: true,
  desc: "JSON → MessagePack 二进制（nil/bool/int/float/str/bin/array/map，整数按最小宽度）",
  params: [OUT_ENC_PARAM],
  run: msgpackEncodeRun,
});
register({
  id: "bsonSerialize", cat: "data", name: "BSON 序列化",
  acceptsBytes: true,
  desc: "JSON → BSON 文档（document/array/string/int32/int64/double/bool/null；ObjectId 等未实现）",
  params: [OUT_ENC_PARAM],
  run: bsonSerializeRun,
});
register({
  id: "phpSerializeGenerate", cat: "data", name: "PHP serialize 生成",
  desc: "JSON → PHP serialize() 字符串（N/b/i/d/s/a；JSON 数组→list、对象→map；O/C/r/R 不出站）",
  params: [],
  run: phpSerializeRun,
});
register({
  id: "protobufEncode", cat: "data", name: "Protobuf 编码",
  acceptsBytes: true,
  desc: "JSON + 简化 .proto schema → Protobuf wire（标量字段 + repeated；wire 0/1/2/5；不做 map/oneof/嵌套）",
  params: [
    { key: "schema", label: "schema（.proto 文本）", type: "textarea", rows: 6, default: "", placeholder: "message Foo {\\n  int32 a = 1;\\n  string b = 2;\\n}" },
    OUT_ENC_PARAM,
  ],
  run: protobufEncodeRun,
});

export {
  cborEncode, cborEncodeRun,
  msgpackEncode, msgpackEncodeRun,
  bsonSerialize, bsonSerializeRun,
  phpSerialize, phpSerializeRun,
  protobufEncode, protobufEncodeRun, parseProtoSchema,
  protoVarint,
};
