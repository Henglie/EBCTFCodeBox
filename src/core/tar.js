import { checkLimit, withLimit } from "./limitGuard.js";

const BLOCK = 512;
const ENC = new TextEncoder();
const DEC = new TextDecoder("utf-8", { fatal: false });
const MAX_OCTAL_11 = 0o77777777777;
const MIB = 1024 * 1024;
// 统一资源口径（与 ZIP / 7z 一致）：软阈值可确认放宽到硬上限，超过硬上限明确失败。
const DEFAULT_MAX_ENTRIES = 1000;                  // 条目数软阈值
const DEFAULT_MAX_ENTRIES_HARD = 5000;             // 条目数硬上限
const DEFAULT_MAX_TOTAL_SIZE = 256 * MIB;          // 提取/创建总输出软阈值
const DEFAULT_MAX_TOTAL_SIZE_HARD = 1024 * MIB;    // 总输出硬上限
const DEFAULT_MAX_ENTRY_SIZE = 256 * MIB;          // 单成员软阈值
const DEFAULT_MAX_ENTRY_SIZE_HARD = 1024 * MIB;    // 单成员硬上限
const DEFAULT_MAX_NAME_LENGTH = 4096;

export class TarError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "TarError";
    this.code = code;
  }
}

function toBytes(value, name = "input") {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (typeof value === "string") return ENC.encode(value);
  throw new TarError("BAD_INPUT", name + " must be Uint8Array, ArrayBuffer, Buffer or string");
}

function readString(bytes, off, len) {
  const end = Math.min(bytes.length, off + len);
  let stop = off;
  while (stop < end && bytes[stop] !== 0) stop++;
  return DEC.decode(bytes.subarray(off, stop));
}

function writeString(bytes, off, len, value) {
  const src = ENC.encode(String(value));
  if (src.length > len) throw new TarError("FIELD_TOO_LONG", "tar field exceeds " + len + " bytes");
  bytes.set(src, off);
}

function truncateUtf8(value, maxBytes) {
  const src = ENC.encode(value);
  if (src.length <= maxBytes) return value;
  let end = maxBytes;
  while (end > 0 && (src[end] & 0xC0) === 0x80) end--;
  return DEC.decode(src.subarray(0, end));
}

function parseNumeric(bytes, off, len, opts = {}) {
  const signed = !!opts.signed;
  const allowEmpty = opts.allowEmpty !== false;
  if (off + len > bytes.length) throw new TarError("TRUNCATED_HEADER", "tar numeric field is truncated");
  const first = bytes[off];
  if (first & 0x80) {
    let v = BigInt(first & 0x7F);
    for (let i = 1; i < len; i++) v = (v << 8n) | BigInt(bytes[off + i]);
    if (signed && (first & 0x40)) v -= 1n << BigInt(8 * len - 1);
    if (v < 0n) {
      if (!signed) throw new TarError("BAD_HEADER", "negative tar numeric field");
      if (v < BigInt(Number.MIN_SAFE_INTEGER)) throw new TarError("BAD_HEADER", "tar numeric field is too small");
      return Number(v);
    }
    if (v > BigInt(Number.MAX_SAFE_INTEGER)) throw new TarError("BAD_HEADER", "tar numeric field is too large");
    return Number(v);
  }
  let start = off;
  let end = off + len;
  while (start < end && (bytes[start] === 0 || bytes[start] === 0x20)) start++;
  while (end > start && (bytes[end - 1] === 0 || bytes[end - 1] === 0x20)) end--;
  if (start === end) {
    if (allowEmpty) return 0;
    throw new TarError("BAD_HEADER", "empty tar numeric field");
  }
  let value = 0;
  for (let i = start; i < end; i++) {
    const c = bytes[i];
    if (c < 0x30 || c > 0x37) {
      throw new TarError("BAD_HEADER", "invalid octal digit in tar header");
    }
    value = value * 8 + (c - 0x30);
    if (!Number.isSafeInteger(value)) throw new TarError("BAD_HEADER", "tar numeric field is too large");
  }
  return value;
}

function writeNumeric(bytes, off, len, value, opts = {}) {
  const signed = !!opts.signed;
  let v = Number(value);
  if (!Number.isFinite(v) || !Number.isInteger(v)) throw new TarError("BAD_OPTION", "tar numeric value must be an integer");
  if (!signed && v < 0) throw new TarError("BAD_OPTION", "tar numeric value must be non-negative");
  const max = 8 ** (len - 1) - 1;
  if (v >= 0 && v <= max) {
    const s = v.toString(8).padStart(len - 1, "0");
    writeString(bytes, off, len - 1, s);
    bytes[off + len - 1] = 0;
    return;
  }
  const big = BigInt(v);
  let fill = big;
  if (fill < 0n) fill = (1n << BigInt(8 * len)) + fill;
  let tmp = fill;
  for (let i = len - 1; i >= 0; i--) {
    bytes[off + i] = Number(tmp & 0xFFn);
    tmp >>= 8n;
  }
  bytes[off] |= 0x80;
}

function checksum(block) {
  let unsigned = 0;
  let signed = 0;
  for (let i = 0; i < BLOCK; i++) {
    const b = i >= 148 && i < 156 ? 0x20 : block[i];
    unsigned += b;
    signed += b < 128 ? b : b - 256;
  }
  return { unsigned, signed };
}

function normalizePath(raw, opts = {}) {
  const directory = !!opts.directory;
  const maxNameLength = opts.maxNameLength != null ? Number(opts.maxNameLength) : DEFAULT_MAX_NAME_LENGTH;
  if (typeof raw !== "string") throw new TarError("INVALID_PATH", "tar entry name must be a string");
  if (!raw) throw new TarError("INVALID_PATH", "tar entry name is empty");
  if (raw.includes("\0")) throw new TarError("INVALID_PATH", "tar entry name contains NUL");
  if (/[\x00-\x1F\x7F]/.test(raw)) throw new TarError("INVALID_PATH", "tar entry name contains control characters");
  let s = raw.replace(/\\/g, "/");
  if (s.startsWith("/") || /^[A-Za-z]:/.test(s)) {
    throw new TarError("PATH_TRAVERSAL", "absolute tar path is not allowed: " + raw);
  }
  const parts = [];
  for (const part of s.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") throw new TarError("PATH_TRAVERSAL", "parent traversal is not allowed: " + raw);
    parts.push(part);
  }
  if (!parts.length) throw new TarError("INVALID_PATH", "tar path resolves to an empty name");
  const joined = parts.join("/");
  if (ENC.encode(joined).length > maxNameLength) throw new TarError("INVALID_PATH", "tar path exceeds maxNameLength");
  return directory ? joined + "/" : joined;
}

function splitUstarName(name) {
  const raw = ENC.encode(name);
  if (raw.length <= 100) return { name, prefix: "" };
  const slash = [];
  for (let i = 0; i < raw.length; i++) if (raw[i] === 0x2F) slash.push(i);
  for (let i = slash.length - 1; i >= 0; i--) {
    const pos = slash[i];
    const prefixBytes = raw.subarray(0, pos);
    const nameBytes = raw.subarray(pos + 1);
    if (prefixBytes.length > 0 && prefixBytes.length <= 155 && nameBytes.length > 0 && nameBytes.length <= 100) {
      return { name: DEC.decode(nameBytes), prefix: DEC.decode(prefixBytes) };
    }
  }
  return null;
}

function paxRecord(key, value) {
  const payload = ENC.encode(key + "=" + value + "\n");
  let len = payload.length + 2;
  while (true) {
    const candidate = String(len).length + 1 + payload.length;
    if (candidate === len) break;
    len = candidate;
  }
  return ENC.encode(String(len) + " " + key + "=" + value + "\n");
}

function makeHeader(fields) {
  const b = new Uint8Array(BLOCK);
  const nameBytes = ENC.encode(fields.name || "");
  const prefixBytes = ENC.encode(fields.prefix || "");
  if (nameBytes.length > 100 || prefixBytes.length > 155) throw new TarError("FIELD_TOO_LONG", "tar name/prefix too long");
  b.set(nameBytes, 0);
  b.set(prefixBytes, 345);
  writeNumeric(b, 100, 8, fields.mode != null ? fields.mode : 0o644);
  writeNumeric(b, 108, 8, fields.uid != null ? fields.uid : 0);
  writeNumeric(b, 116, 8, fields.gid != null ? fields.gid : 0);
  writeNumeric(b, 124, 12, fields.size != null ? fields.size : 0);
  writeNumeric(b, 136, 12, fields.mtime != null ? fields.mtime : 0, { signed: true });
  b.fill(0x20, 148, 156);
  const tf = fields.typeflag != null ? fields.typeflag : 0x30;
  b[156] = typeof tf === "string" ? tf.charCodeAt(0) : tf;
  const linkBytes = ENC.encode(fields.linkname || "");
  if (linkBytes.length > 100) throw new TarError("FIELD_TOO_LONG", "tar linkname too long");
  b.set(linkBytes, 157);
  writeString(b, 257, 6, "ustar");
  b[262] = 0;
  writeString(b, 263, 2, "00");
  writeString(b, 265, 32, fields.uname || "");
  writeString(b, 297, 32, fields.gname || "");
  writeNumeric(b, 329, 8, 0);
  writeNumeric(b, 337, 8, 0);
  const sum = checksum(b).unsigned;
  const s = sum.toString(8).padStart(6, "0");
  writeString(b, 148, 6, s);
  b[154] = 0;
  b[155] = 0x20;
  return b;
}

function paddedSize(size) {
  return size === 0 ? 0 : Math.ceil(size / BLOCK) * BLOCK;
}

function dataBlock(data) {
  const out = new Uint8Array(paddedSize(data.length));
  out.set(data, 0);
  return out;
}

function paxData(records) {
  const chunks = records.map(([k, v]) => paxRecord(k, v));
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}

function paxHeaderName(base) {
  const fixed = "PaxHeaders.0/";
  return truncateUtf8(fixed + (base || "entry"), 100);
}

function parsePax(data) {
  const map = new Map();
  let off = 0;
  while (off < data.length) {
    let space = off;
    while (space < data.length && data[space] !== 0x20) {
      const c = data[space];
      if (c < 0x30 || c > 0x39) throw new TarError("MALFORMED_PAX", "invalid pax record length");
      space++;
    }
    if (space >= data.length) throw new TarError("MALFORMED_PAX", "pax record has no space");
    const len = Number(DEC.decode(data.subarray(off, space)));
    if (!Number.isSafeInteger(len) || len <= space - off + 1 || off + len > data.length) {
      throw new TarError("MALFORMED_PAX", "invalid pax record length");
    }
    const record = data.subarray(space + 1, off + len);
    let eq = -1;
    for (let i = 0; i < record.length; i++) if (record[i] === 0x3D) { eq = i; break; }
    if (eq <= 0) throw new TarError("MALFORMED_PAX", "pax record has no key");
    const key = DEC.decode(record.subarray(0, eq));
    let valueEnd = record.length;
    if (valueEnd > 0 && record[valueEnd - 1] === 0x0A) valueEnd--;
    const value = DEC.decode(record.subarray(eq + 1, valueEnd));
    map.set(key, value);
    off += len;
    if (off > data.length) throw new TarError("MALFORMED_PAX", "pax record exceeds header data");
  }
  return map;
}

function applyPax(map, target) {
  if (!map) return target;
  for (const [key, value] of map) {
    if (key === "path") target.path = value;
    else if (key === "linkpath") target.linkpath = value;
    else if (key === "size") {
      const n = Number(value);
      if (!Number.isSafeInteger(n) || n < 0) throw new TarError("MALFORMED_PAX", "invalid pax size");
      target.size = n;
    } else if (key === "mtime") {
      const n = Number(value);
      if (!Number.isFinite(n)) throw new TarError("MALFORMED_PAX", "invalid pax mtime");
      target.mtime = n;
    } else if (key === "uid") {
      const n = Number(value);
      if (!Number.isSafeInteger(n) || n < 0) throw new TarError("MALFORMED_PAX", "invalid pax uid");
      target.uid = n;
    } else if (key === "gid") {
      const n = Number(value);
      if (!Number.isSafeInteger(n) || n < 0) throw new TarError("MALFORMED_PAX", "invalid pax gid");
      target.gid = n;
    }
  }
  return target;
}

function parseHeader(block) {
  const stored = parseNumeric(block, 148, 8, { allowEmpty: false });
  const sum = checksum(block);
  const signedStored = sum.signed < 0 ? (sum.signed + 0o1000000) & 0o777777 : sum.signed;
  if (stored !== sum.unsigned && stored !== signedStored) {
    throw new TarError("BAD_CHECKSUM", "tar header checksum mismatch");
  }
  const name = readString(block, 0, 100);
  const prefix = readString(block, 345, 155);
  const fullName = prefix ? prefix + "/" + name : name;
  const typeByte = block[156];
  return {
    name: fullName,
    mode: parseNumeric(block, 100, 8) & 0o7777,
    uid: parseNumeric(block, 108, 8),
    gid: parseNumeric(block, 116, 8),
    size: parseNumeric(block, 124, 12),
    mtime: parseNumeric(block, 136, 12, { signed: true }),
    typeflag: typeByte === 0 ? "0" : String.fromCharCode(typeByte),
    linkname: readString(block, 157, 100),
    uname: readString(block, 265, 32),
    gname: readString(block, 297, 32),
  };
}

function typeOf(typeflag) {
  if (typeflag === "0" || typeflag === "7" || typeflag === "\0") return "file";
  if (typeflag === "5") return "dir";
  if (typeflag === "1") return "hardlink";
  if (typeflag === "2") return "symlink";
  if (typeflag === "3" || typeflag === "4" || typeflag === "6") return "other";
  return "other";
}

function readBody(bytes, off, size, limits, ctx, what, scope) {
  enforceLimit(ctx, scope, size, limits.entrySize, what + "大小", " 字节");
  if (off + size > bytes.length) throw new TarError("TRUNCATED_DATA", what + " is truncated");
  return bytes.subarray(off, off + size);
}

function optionInt(value, fallback, name) {
  if (value == null) return fallback;
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 0) throw new TarError("BAD_OPTION", name + " must be a non-negative integer");
  return n;
}

/**
 * 统一软/硬阈值。options.max* 只收紧软阈值（旧参数继续有效），
 * 硬上限固定为策略值，确认后最多放宽到硬上限。
 */
function limitPair(value, soft, hard, name) {
  const requested = optionInt(value, null, name);
  return {
    soft: requested == null ? soft : Math.min(requested, soft),
    hard,
  };
}

/** 超软阈值走 checkLimit（可确认）；确认后把 override 写回本次调用的 ctx.params 复用。 */
function enforceLimit(ctx, scope, actual, pair, label, unit) {
  if (actual <= pair.soft) return;
  checkLimit({
    scope,
    actual,
    soft: pair.soft,
    hard: pair.hard,
    params: ctx.params,
    label,
    unit,
  });
  ctx.params = withLimit(ctx.params, { _allowLimitOverride: true });
}

export function tarCreate(entries, options = {}) {
  if (!Array.isArray(entries)) throw new TarError("BAD_INPUT", "entries must be an array");
  const limits = {
    entries: limitPair(options.maxEntries, DEFAULT_MAX_ENTRIES, DEFAULT_MAX_ENTRIES_HARD, "maxEntries"),
    totalSize: limitPair(options.maxTotalSize, DEFAULT_MAX_TOTAL_SIZE, DEFAULT_MAX_TOTAL_SIZE_HARD, "maxTotalSize"),
    entrySize: limitPair(options.maxEntrySize, DEFAULT_MAX_ENTRY_SIZE, DEFAULT_MAX_ENTRY_SIZE_HARD, "maxEntrySize"),
  };
  const maxNameLength = optionInt(options.maxNameLength, DEFAULT_MAX_NAME_LENGTH, "maxNameLength");
  const allowPax = options.pax !== false;
  const ctx = { params: options.params || null };
  enforceLimit(ctx, "tar.create.entries", entries.length, limits.entries, "TAR 创建条目数", " 个");

  const chunks = [];
  let archiveSize = 0;
  let totalData = 0;

  const push = (chunk) => {
    chunks.push(chunk);
    archiveSize += chunk.length;
  };

  for (const entry of entries) {
    if (!entry || typeof entry !== "object") throw new TarError("BAD_INPUT", "each tar entry must be an object");
    const requestedType = entry.type || (entry.data === undefined && entry.bytes === undefined && /\/$/.test(entry.name || "") ? "dir" : "file");
    const type = String(requestedType).toLowerCase();
    const isDir = type === "dir" || type === "directory";
    if (!["file", "dir", "directory", "symlink", "hardlink"].includes(type)) {
      throw new TarError("BAD_INPUT", "unsupported tar entry type: " + requestedType);
    }
    const name = normalizePath(entry.name, { directory: isDir, maxNameLength });
    let data = new Uint8Array(0);
    if (!isDir && type !== "symlink" && type !== "hardlink") {
      data = toBytes(entry.data !== undefined ? entry.data : entry.bytes, "entry data");
    }
    enforceLimit(ctx, "tar.create.entrySize", data.length, limits.entrySize, "TAR 创建单成员", " 字节");
    totalData += data.length;
    enforceLimit(ctx, "tar.create.totalOutput", totalData, limits.totalSize, "TAR 创建总输出", " 字节");

    const mode = entry.mode != null ? Number(entry.mode) : (isDir ? 0o755 : 0o644);
    const uid = entry.uid != null ? Number(entry.uid) : 0;
    const gid = entry.gid != null ? Number(entry.gid) : 0;
    const mtime = entry.mtime != null ? Number(entry.mtime) : 0;
    const linkname = entry.linkname != null ? String(entry.linkname) : "";
    const typeflag = isDir ? "5" : type === "symlink" ? "2" : type === "hardlink" ? "1" : "0";

    const paxRecords = [];
    let split = splitUstarName(name);
    if (!split) {
      if (!allowPax) throw new TarError("NAME_TOO_LONG", "name needs pax but pax is disabled: " + name);
      paxRecords.push(["path", name]);
    }
    if (data.length > MAX_OCTAL_11) {
      if (!allowPax) throw new TarError("SIZE_TOO_LARGE", "size needs pax but pax is disabled");
      paxRecords.push(["size", String(data.length)]);
    }
    if (mtime < 0 || mtime > MAX_OCTAL_11) {
      if (!allowPax) throw new TarError("MTIME_TOO_LARGE", "mtime needs pax but pax is disabled");
      paxRecords.push(["mtime", String(mtime)]);
    }
    if (ENC.encode(linkname).length > 100) {
      if (!allowPax) throw new TarError("NAME_TOO_LONG", "linkname needs pax but pax is disabled");
      paxRecords.push(["linkpath", linkname]);
    }

    if (paxRecords.length) {
      const meta = paxData(paxRecords);
      const base = name.replace(/\/$/, "").split("/").pop() || "entry";
      const paxName = paxHeaderName(base);
      const paxBlock = makeHeader({
        name: paxName,
        mode: 0o644,
        uid,
        gid,
        size: meta.length,
        mtime: mtime >= 0 ? mtime : 0,
        typeflag: 0x78,
        linkname: "",
      });
      push(paxBlock);
      push(dataBlock(meta));
    }

    if (!split) split = { name: truncateUtf8(name.replace(/\/$/, "").split("/").pop() || "entry", 100), prefix: "" };
    const header = makeHeader({
      name: split.name,
      prefix: split.prefix,
      mode,
      uid,
      gid,
      size: data.length > MAX_OCTAL_11 ? 0 : data.length,
      mtime,
      typeflag,
      linkname: ENC.encode(linkname).length <= 100 ? linkname : "",
    });
    push(header);
    if (data.length) push(dataBlock(data));
  }

  const end = new Uint8Array(BLOCK * 2);
  push(end);
  const out = new Uint8Array(archiveSize);
  let off = 0;
  for (const chunk of chunks) { out.set(chunk, off); off += chunk.length; }
  return out;
}

export function tarExtract(input, options = {}) {
  const bytes = toBytes(input);
  const limits = {
    entries: limitPair(options.maxEntries, DEFAULT_MAX_ENTRIES, DEFAULT_MAX_ENTRIES_HARD, "maxEntries"),
    totalSize: limitPair(options.maxTotalSize, DEFAULT_MAX_TOTAL_SIZE, DEFAULT_MAX_TOTAL_SIZE_HARD, "maxTotalSize"),
    entrySize: limitPair(options.maxEntrySize, DEFAULT_MAX_ENTRY_SIZE, DEFAULT_MAX_ENTRY_SIZE_HARD, "maxEntrySize"),
  };
  const maxNameLength = optionInt(options.maxNameLength, DEFAULT_MAX_NAME_LENGTH, "maxNameLength");
  const includeData = options.includeData !== false;
  const ctx = { params: options.params || null };

  const entries = [];
  let off = 0;
  let totalData = 0;
  let nextPax = null;
  let globalPax = null;
  let longName = null;
  let longLink = null;

  while (off < bytes.length) {
    if (bytes.length - off < BLOCK) {
      let allZero = true;
      for (let i = off; i < bytes.length; i++) if (bytes[i] !== 0) { allZero = false; break; }
      if (allZero) break;
      throw new TarError("TRUNCATED_HEADER", "tar header is truncated");
    }
    const block = bytes.subarray(off, off + BLOCK);
    let allZero = true;
    for (let i = 0; i < BLOCK; i++) if (block[i] !== 0) { allZero = false; break; }
    if (allZero) break;
    const h = parseHeader(block);
    off += BLOCK;

    if (h.typeflag === "x" || h.typeflag === "g" || h.typeflag === "X") {
      const body = readBody(bytes, off, h.size, limits, ctx, "TAR pax 元数据", "tar.extract.paxHeader");
      off += paddedSize(h.size);
      if (off > bytes.length) throw new TarError("TRUNCATED_DATA", "pax header is truncated");
      const map = parsePax(body);
      if (h.typeflag === "g") {
        globalPax = globalPax ? new Map([...globalPax, ...map]) : map;
      } else {
        nextPax = nextPax ? new Map([...nextPax, ...map]) : map;
      }
      continue;
    }
    if (h.typeflag === "L") {
      const body = readBody(bytes, off, h.size, limits, ctx, "TAR GNU 长名", "tar.extract.longName");
      off += paddedSize(h.size);
      if (off > bytes.length) throw new TarError("TRUNCATED_DATA", "GNU longname is truncated");
      longName = DEC.decode(body).replace(/\0.*$/, "");
      continue;
    }
    if (h.typeflag === "K") {
      const body = readBody(bytes, off, h.size, limits, ctx, "TAR GNU 长链接", "tar.extract.longLink");
      off += paddedSize(h.size);
      if (off > bytes.length) throw new TarError("TRUNCATED_DATA", "GNU longlink is truncated");
      longLink = DEC.decode(body).replace(/\0.*$/, "");
      continue;
    }

    if (h.typeflag === "S" || h.typeflag === "V") {
      throw new TarError("UNSUPPORTED", "unsupported tar type " + h.typeflag);
    }

    const type = typeOf(h.typeflag);
    const overrides = { path: null, linkpath: null, size: null, mtime: null, uid: null, gid: null };
    applyPax(globalPax, overrides);
    applyPax(nextPax, overrides);
    if (longName != null) overrides.path = longName;
    if (longLink != null) overrides.linkpath = longLink;

    let name = overrides.path != null ? overrides.path : h.name;
    let linkname = overrides.linkpath != null ? overrides.linkpath : h.linkname;
    const bodySize = overrides.size != null ? overrides.size : h.size;
    // 列表模式只读元数据，不复制/限制成员内容；提取模式才占用单成员与总输出预算。
    if (includeData) enforceLimit(ctx, "tar.extract.entrySize", bodySize, limits.entrySize, "TAR 单成员", " 字节");
    if (bodySize > bytes.length - off) throw new TarError("TRUNCATED_DATA", "entry data is truncated: " + name);

    const body = bytes.subarray(off, off + bodySize);
    const next = off + paddedSize(bodySize);
    off = next <= bytes.length ? next : bytes.length;
    if (type === "dir" && (name === "." || name === "./" || name === ".//")) {
      nextPax = null;
      longName = null;
      longLink = null;
      continue;
    }
    const safeName = normalizePath(name, { directory: type === "dir", maxNameLength });

    enforceLimit(ctx, "tar.extract.entries", entries.length + 1, limits.entries, "TAR 条目数", " 个");
    if (type === "file" && includeData) {
      totalData += bodySize;
      enforceLimit(ctx, "tar.extract.totalOutput", totalData, limits.totalSize, "TAR 提取总输出", " 字节");
    }
    entries.push({
      name: safeName,
      type,
      typeflag: h.typeflag,
      size: type === "file" ? bodySize : 0,
      mode: h.mode,
      uid: overrides.uid != null ? overrides.uid : h.uid,
      gid: overrides.gid != null ? overrides.gid : h.gid,
      mtime: overrides.mtime != null ? overrides.mtime : h.mtime,
      uname: h.uname,
      gname: h.gname,
      linkname: type === "symlink" || type === "hardlink" ? linkname : "",
      data: type === "file" && includeData ? new Uint8Array(body) : null,
    });

    nextPax = null;
    longName = null;
    longLink = null;
  }

  return entries;
}

export function tarList(input, options = {}) {
  return tarExtract(input, { ...options, includeData: false }).map((entry) => ({
    name: entry.name,
    type: entry.type,
    typeflag: entry.typeflag,
    size: entry.size,
    mode: entry.mode,
    uid: entry.uid,
    gid: entry.gid,
    mtime: entry.mtime,
    linkname: entry.linkname,
  }));
}

export {
  DEFAULT_MAX_ENTRIES,
  DEFAULT_MAX_ENTRIES_HARD,
  DEFAULT_MAX_TOTAL_SIZE,
  DEFAULT_MAX_TOTAL_SIZE_HARD,
  DEFAULT_MAX_ENTRY_SIZE,
  DEFAULT_MAX_ENTRY_SIZE_HARD,
  DEFAULT_MAX_NAME_LENGTH,
};
