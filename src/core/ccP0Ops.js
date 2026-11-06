import { register } from "./registry.js";
import { cobsEncode, cobsDecode } from "./cobs.js";
import {
  lzmaEncode, lzmaEncodeRaw, lzmaDecode, isLzmaAlone,
  propsToBytes, parsePropsBytes,
} from "./lzma.js";
import { tarCreate, tarExtract, tarList } from "./tar.js";

const TE = new TextEncoder();
const TD = new TextDecoder("utf-8");

function hexToBytes(s) {
  const h = String(s || "").replace(/\s+/g, "");
  if (!h || h.length % 2 || !/^[0-9a-fA-F]+$/.test(h)) throw new Error("输入不是合法 hex");
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < h.length; i += 2) out[i / 2] = parseInt(h.slice(i, i + 2), 16);
  return out;
}

function b64ToBytes(s) {
  const str = String(s || "").replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/");
  if (!str || !/^[A-Za-z0-9+/]*={0,2}$/.test(str)) throw new Error("输入不是合法 base64");
  const padded = str + "=".repeat((4 - (str.length % 4)) % 4);
  let bin;
  try { bin = atob(padded); } catch { throw new Error("输入不是合法 base64"); }
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToHex(bytes) {
  let s = "";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s;
}

function bytesToB64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i], b = i + 1 < bytes.length ? bytes[i + 1] : 0, c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    s += "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"[a >> 2];
    s += "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"[((a & 3) << 4) | (b >> 4)];
    s += i + 1 < bytes.length ? "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"[((b & 15) << 2) | (c >> 6)] : "=";
    s += i + 2 < bytes.length ? "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"[c & 63] : "=";
  }
  return s;
}

function toBytes(text, enc = "auto") {
  const raw = text;
  if (raw instanceof Uint8Array) return raw;
  const s = String(raw ?? "");
  const e = String(enc || "auto").toLowerCase();
  if (e === "hex") return hexToBytes(s);
  if (e === "base64") return b64ToBytes(s);
  if (e === "utf8") return TE.encode(s);
  const compact = s.trim().replace(/\s+/g, "");
  if (compact.length >= 2 && compact.length % 2 === 0 && /^[0-9a-fA-F]+$/.test(compact)) return hexToBytes(compact);
  if (compact.length >= 4 && /^[A-Za-z0-9+/=_-]+$/.test(compact)) {
    try { return b64ToBytes(compact); } catch { /* fall through */ }
  }
  return TE.encode(s);
}

function fromBytes(bytes, enc = "auto", binary = false) {
  const e = String(enc || "auto").toLowerCase();
  if (e === "hex") return bytesToHex(bytes);
  if (e === "base64") return bytesToB64(bytes);
  if (e === "utf8") return TD.decode(bytes);
  if (binary) return bytesToB64(bytes);
  try {
    const s = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (!s.includes("\u0000")) return s;
  } catch { /* binary */ }
  return bytesToHex(bytes);
}

function cobsRun(text, p = {}) {
  if (p.inputEnc != null && String(p.inputEnc).toLowerCase() !== "auto") {
    throw new Error("inputEnc 该参数已废弃，请改用输入视图");
  }
  if (p.outEnc != null && String(p.outEnc).toLowerCase() !== "auto") {
    throw new Error("outEnc 该参数已废弃，请改用输入视图");
  }
  const dir = String(p.dir || "encode").toLowerCase();
  const input = p.rawBytes != null
    ? (p.rawBytes instanceof Uint8Array ? p.rawBytes : new Uint8Array(p.rawBytes))
    : toBytes(text, "auto");
  if (dir === "encode") return fromBytes(cobsEncode(input), "auto", true);
  if (dir === "decode") return fromBytes(cobsDecode(input), "auto", false);
  throw new Error("COBS：dir 只能是 encode / decode");
}

async function lzmaRun(text, p = {}) {
  const dir = String(p.dir || "decode").toLowerCase();
  const format = String(p.format || "auto").toLowerCase();
  const input = toBytes(text, p.inputEnc || "auto");
  if (dir === "encode") {
    const preset = p.preset == null || p.preset === "" ? 6 : Number(p.preset);
    if (!Number.isInteger(preset) || preset < 0 || preset > 9) throw new Error("LZMA：preset 必须是 0..9");
    if (format === "raw") {
      const r = await lzmaEncodeRaw(input, { preset });
      return `props=${bytesToHex(propsToBytes(r.props))}\nsize=${r.size}\n${fromBytes(r.bytes, p.outEnc || "base64", true)}`;
    }
    return fromBytes(await lzmaEncode(input, { preset }), p.outEnc || "auto", true);
  }
  if (dir !== "decode") throw new Error("LZMA：dir 只能是 encode / decode");
  let bytes = input;
  let props = p.props ? parsePropsBytes(p.props) : null;
  let size = p.size == null || p.size === "" ? null : Number(p.size);
  const s = String(text);
  const m = /^props=([0-9a-fA-F]+)\r?\nsize=(\d+)\r?\n([\s\S]*)$/.exec(s);
  if (m) {
    props = parsePropsBytes(m[1]);
    size = Number(m[2]);
    bytes = toBytes(m[3], p.inputEnc === "auto" ? "base64" : p.inputEnc);
  }
  if (format === "raw" || (format === "auto" && !isLzmaAlone(bytes))) {
    if (!props) throw new Error("LZMA raw 解码需要 props（5 字节属性）");
    return fromBytes(await lzmaDecode(bytes, { format: "raw", props, size }), p.outEnc || "auto", false);
  }
  return fromBytes(await lzmaDecode(bytes, { format: "lzma" }), p.outEnc || "auto", false);
}

function parseEntries(text) {
  let value;
  try { value = JSON.parse(String(text || "[]")); } catch (e) { throw new Error("Tar entries 不是合法 JSON：" + e.message); }
  if (!Array.isArray(value)) throw new Error("Tar entries 必须是数组");
  return value.map((e, i) => {
    if (!e || typeof e !== "object") throw new Error(`Tar entries[${i}] 必须是对象`);
    const name = String(e.name || "").trim();
    if (!name) throw new Error(`Tar entries[${i}].name 不能为空`);
    const enc = String(e.dataEnc || "utf8").toLowerCase();
    const data = e.data == null ? new Uint8Array(0) : toBytes(e.data, enc);
    return { name, data, type: e.type || "file", mode: e.mode, mtime: e.mtime };
  });
}

function tarRun(text, p = {}) {
  const dir = String(p.dir || "list").toLowerCase();
  if (dir === "create") {
    const bytes = tarCreate(parseEntries(p.entries || text), {
      maxEntries: Number(p.maxEntries) || undefined,
      maxTotalSize: Number(p.maxTotalSize) || undefined,
      maxEntrySize: Number(p.maxEntrySize) || undefined,
    });
    return fromBytes(bytes, p.outEnc || "auto", true);
  }
  const input = toBytes(text, p.inputEnc || "auto");
  if (dir === "list") {
    const rows = tarList(input);
    return rows.map((e) => `${e.type === "dir" ? "d" : "-"} ${String(e.size).padStart(10)} ${e.name}`).join("\n");
  }
  if (dir === "extract") {
    const entries = tarExtract(input, {
      maxEntries: Number(p.maxEntries) || undefined,
      maxTotalSize: Number(p.maxTotalSize) || undefined,
      maxEntrySize: Number(p.maxEntrySize) || undefined,
    });
    const files = entries.filter((e) => e.type !== "dir").map((e) => ({ name: e.name, bytes: e.data, mime: "application/octet-stream" }));
    return { text: `已提取 ${files.length} 个文件`, files };
  }
  throw new Error("Tar：dir 只能是 list / extract / create");
}

register({
  id: "cobs",
  family: "cobs",
  cat: "text",
  name: "COBS 编码 / 解码",
  desc: "Consistent Overhead Byte Stuffing：用非零字节替换 0x00，适合串口/协议/嵌入式帧定界；支持 hex/base64/UTF-8 输入输出。",
  params: [
    { key: "dir", label: "方向", type: "select", default: "encode", options: [{ value: "encode", label: "编码" }, { value: "decode", label: "解码" }] },
  ],
  run: cobsRun,
  acceptsBytes: true,
});

register({
  id: "lzma",
  family: "lzma",
  cat: "archive",
  name: "LZMA 压缩 / 解压",
  desc: "LZMA1 .lzma / raw 解压与压缩；复用 7z-wasm，缺失时明确报错；支持 hex/base64/UTF-8 输入输出和 raw props/size。",
  params: [
    { key: "dir", label: "方向", type: "select", default: "decode", options: [{ value: "decode", label: "解压" }, { value: "encode", label: "压缩" }] },
    { key: "format", label: "格式", type: "select", default: "auto", options: [{ value: "auto", label: "自动" }, { value: "lzma", label: ".lzma（13 字节头）" }, { value: "raw", label: "raw LZMA1" }] },
    { key: "inputEnc", label: "输入编码", type: "select", default: "auto", options: [{ value: "auto", label: "自动" }, { value: "hex", label: "Hex" }, { value: "base64", label: "Base64" }, { value: "utf8", label: "UTF-8" }] },
    { key: "outEnc", label: "输出编码", type: "select", default: "auto", options: [{ value: "auto", label: "自动" }, { value: "hex", label: "Hex" }, { value: "base64", label: "Base64" }, { value: "utf8", label: "UTF-8" }] },
    { key: "preset", label: "压缩级别（0-9）", type: "number", default: 6 },
    { key: "props", label: "raw props（5 字节 hex）", type: "text", default: "", placeholder: "仅 raw 解码需要，如 5d00001000" },
    { key: "size", label: "raw 解压后大小", type: "number", default: "" },
  ],
  run: lzmaRun,
  acceptsBytes: true,
});

register({
  id: "tar",
  family: "tar",
  cat: "archive",
  name: "Tar 创建 / 列表 / 提取",
  desc: "纯 JS Tar：列表、内存提取、JSON entries 创建；支持 ustar prefix/PAX/GNU 长名，拒绝路径穿越、条目数和大小超限，不写磁盘。",
  params: [
    { key: "dir", label: "方向", type: "select", default: "list", options: [{ value: "list", label: "列表" }, { value: "extract", label: "提取" }, { value: "create", label: "创建" }] },
    { key: "inputEnc", label: "输入编码", type: "select", default: "auto", options: [{ value: "auto", label: "自动" }, { value: "hex", label: "Hex" }, { value: "base64", label: "Base64" }, { value: "utf8", label: "UTF-8" }] },
    { key: "outEnc", label: "输出编码（create）", type: "select", default: "auto", options: [{ value: "auto", label: "自动" }, { value: "hex", label: "Hex" }, { value: "base64", label: "Base64" }] },
    { key: "entries", label: "创建条目 JSON", type: "textarea", rows: 6, default: "", placeholder: "[{\"name\":\"a.txt\",\"data\":\"hello\"}]" },
    { key: "maxEntries", label: "最大条目数", type: "number", default: 10000 },
    { key: "maxTotalSize", label: "最大总大小", type: "number", default: 268435456 },
    { key: "maxEntrySize", label: "单条最大大小", type: "number", default: 67108864 },
  ],
  run: tarRun,
  acceptsBytes: true,
});

export { cobsRun, lzmaRun, tarRun };
