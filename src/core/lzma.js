const WASM_URL = new URL("../../public/wasm/7zz.js", import.meta.url).href;
const MAX_U64 = 0xFFFFFFFFFFFFFFFFn;
const DEFAULT_MAX_INPUT = 128 * 1024 * 1024;
const DEFAULT_MAX_OUTPUT = 64 * 1024 * 1024;
const EMPTY_RAW = Uint8Array.from([0x00, 0x83, 0xFF, 0xFB, 0xFF, 0xFF, 0xC0, 0x00, 0x00, 0x00]);
const EMPTY_PROPS = { lc: 3, lp: 0, pb: 2, dictSize: 1 << 23 };

export class LzmaError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "LzmaError";
    this.code = code;
  }
}

let _modPromise = null;
let _available = null;
let _loadError = null;
let _sink = null;
let _queue = Promise.resolve();
let _seq = 0;

function toBytes(value, name = "input") {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  throw new LzmaError("BAD_INPUT", name + " must be Uint8Array, ArrayBuffer or Buffer");
}

function u32le(bytes, off) {
  return (bytes[off] | (bytes[off + 1] << 8) | (bytes[off + 2] << 16) | (bytes[off + 3] * 0x1000000)) >>> 0;
}

function readU64le(bytes, off) {
  let v = 0n;
  for (let i = 7; i >= 0; i--) v = (v << 8n) | BigInt(bytes[off + i]);
  return v;
}

function writeU64le(bytes, off, value) {
  let v = BigInt(value);
  for (let i = 0; i < 8; i++) {
    bytes[off + i] = Number(v & 0xFFn);
    v >>= 8n;
  }
}

let _crcTable = null;
function crc32(bytes, start, end) {
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

function parsePropsByte(byte) {
  if (!Number.isInteger(byte) || byte < 0 || byte >= 225) {
    throw new LzmaError("BAD_PROPS", "LZMA properties byte must be 0..224");
  }
  const lc = byte % 9;
  const rest = Math.floor(byte / 9);
  const lp = rest % 5;
  const pb = Math.floor(rest / 5);
  return { lc, lp, pb };
}

function propsToBytes(props) {
  const lc = Number(props.lc);
  const lp = Number(props.lp);
  const pb = Number(props.pb);
  const dictSize = Number(props.dictSize);
  if (![lc, lp, pb].every(Number.isInteger) || lc < 0 || lc > 8 || lp < 0 || lp > 4 || pb < 0 || pb > 4) {
    throw new LzmaError("BAD_PROPS", "invalid LZMA lc/lp/pb");
  }
  if (lc + lp > 4) throw new LzmaError("BAD_PROPS", "LZMA requires lc + lp <= 4");
  if (!Number.isInteger(dictSize) || dictSize < 4096 || dictSize > 0xFFFFFFFF) {
    throw new LzmaError("BAD_PROPS", "invalid LZMA dictionary size");
  }
  const out = new Uint8Array(5);
  out[0] = (pb * 5 + lp) * 9 + lc;
  out[1] = dictSize & 0xFF;
  out[2] = (dictSize >>> 8) & 0xFF;
  out[3] = (dictSize >>> 16) & 0xFF;
  out[4] = (dictSize >>> 24) & 0xFF;
  return out;
}

function parsePropsBytes(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 5) {
    throw new LzmaError("BAD_PROPS", "LZMA properties need 5 bytes");
  }
  const base = parsePropsByte(bytes[0]);
  const dictSize = u32le(bytes, 1);
  if (dictSize < 4096) throw new LzmaError("BAD_PROPS", "LZMA dictionary size is too small");
  return { ...base, dictSize };
}

function normalizeProps(opts = {}) {
  let props = opts.props;
  if (props instanceof Uint8Array || Array.isArray(props)) {
    return parsePropsBytes(Uint8Array.from(props));
  }
  if (typeof props === "string") {
    const s = props.trim();
    if (/^[0-9a-fA-F]{10}$/.test(s)) {
      const out = new Uint8Array(5);
      for (let i = 0; i < 5; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
      return parsePropsBytes(out);
    }
    if (/^[0-9a-fA-F]{2}$/.test(s)) {
      const base = parsePropsByte(parseInt(s, 16));
      return { ...base, dictSize: opts.dictSize != null ? Number(opts.dictSize) : EMPTY_PROPS.dictSize };
    }
    if (s.startsWith("{")) {
      try { props = JSON.parse(s); } catch { throw new LzmaError("BAD_PROPS", "invalid JSON LZMA properties"); }
    } else if (/^[0-9]+$/.test(s)) {
      const byte = Number(s);
      const base = parsePropsByte(byte);
      return { ...base, dictSize: opts.dictSize != null ? Number(opts.dictSize) : EMPTY_PROPS.dictSize };
    } else {
      const parts = s.split(/[,;\s]+/).filter(Boolean).map(Number);
      if (parts.length >= 3) {
        return {
          lc: parts[0], lp: parts[1], pb: parts[2],
          dictSize: parts.length >= 4 ? parts[3] : (opts.dictSize != null ? Number(opts.dictSize) : EMPTY_PROPS.dictSize),
        };
      }
      throw new LzmaError("BAD_PROPS", "invalid LZMA properties string");
    }
  }
  if (props && typeof props === "object") {
    return {
      lc: props.lc != null ? Number(props.lc) : EMPTY_PROPS.lc,
      lp: props.lp != null ? Number(props.lp) : EMPTY_PROPS.lp,
      pb: props.pb != null ? Number(props.pb) : EMPTY_PROPS.pb,
      dictSize: props.dictSize != null ? Number(props.dictSize) : (opts.dictSize != null ? Number(opts.dictSize) : EMPTY_PROPS.dictSize),
    };
  }
  return {
    lc: opts.lc != null ? Number(opts.lc) : EMPTY_PROPS.lc,
    lp: opts.lp != null ? Number(opts.lp) : EMPTY_PROPS.lp,
    pb: opts.pb != null ? Number(opts.pb) : EMPTY_PROPS.pb,
    dictSize: opts.dictSize != null ? Number(opts.dictSize) : EMPTY_PROPS.dictSize,
  };
}

function isLzmaAlone(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 13) return false;
  if (bytes[0] >= 225) return false;
  const dictSize = u32le(bytes, 1);
  if (dictSize < 4096 || dictSize > 0x60000000) return false;
  const size = readU64le(bytes, 5);
  if (size !== MAX_U64 && size > BigInt(Number.MAX_SAFE_INTEGER)) return false;
  return true;
}

function makeAlone(propsBytes, size) {
  const out = new Uint8Array(13 + 0);
  out.set(propsBytes.subarray(0, 5), 0);
  if (size == null) out.fill(0xFF, 5, 13);
  else writeU64le(out, 5, BigInt(size));
  return out;
}

async function loadWasm() {
  if (_modPromise) return _modPromise;
  _modPromise = (async () => {
    try {
      const mod = await import(/* @vite-ignore */ WASM_URL);
      const create = mod.default || mod.SevenZip || mod.createSevenZip;
      if (typeof create !== "function") {
        _available = false;
        _loadError = new Error("7zz.js has no module factory export");
        return null;
      }
      const instance = await create({
        noInitialRun: true,
        print: (t) => { if (_sink) _sink.push(String(t)); },
        printErr: (t) => { if (_sink) _sink.push(String(t)); },
      });
      _available = true;
      return instance;
    } catch (e) {
      _available = false;
      _loadError = e;
      return null;
    }
  })();
  return _modPromise;
}

function lzmaWasmAvailable() {
  return _available;
}

function lzmaWasmError() {
  return _loadError;
}

function withWasm(fn) {
  const run = async () => {
    const mod = await loadWasm();
    if (!mod) {
      const detail = _loadError && _loadError.message ? ": " + _loadError.message : "";
      throw new LzmaError("WASM_UNAVAILABLE", "7z-wasm unavailable (public/wasm/7zz.js + 7zz.wasm)" + detail);
    }
    return fn(mod);
  };
  const p = _queue.then(run, run);
  _queue = p.then(() => undefined, () => undefined);
  return p;
}

function run7z(mod, argv) {
  _sink = [];
  let code = 0;
  try {
    mod.callMain(argv);
  } catch (e) {
    code = typeof e === "number" ? e : ((e && (e.status ?? e.code)) ?? -1);
  }
  const out = _sink ? _sink.join("\n") : "";
  _sink = null;
  return { code, out };
}

function fsRmRf(FS, path) {
  let entries;
  try { entries = FS.readdir(path); } catch { return; }
  for (const name of entries) {
    if (name === "." || name === "..") continue;
    const full = path + "/" + name;
    let st;
    try { st = FS.stat(full); } catch { continue; }
    if (FS.isDir(st.mode)) fsRmRf(FS, full);
    else { try { FS.unlink(full); } catch { } }
  }
  try { FS.rmdir(path); } catch { }
}

function nextId(prefix) {
  _seq++;
  return prefix + "_" + Date.now().toString(36) + "_" + _seq;
}

function concatBytes(a, b) {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

function outputFiles(FS, dir) {
  const names = [];
  let entries;
  try { entries = FS.readdir(dir); } catch { return names; }
  for (const name of entries) {
    if (name === "." || name === "..") continue;
    const full = dir + "/" + name;
    let st;
    try { st = FS.stat(full); } catch { continue; }
    if (!FS.isDir(st.mode)) names.push({ name, full, size: st.size });
  }
  return names;
}

export async function lzmaDecode(input, opts = {}) {
  const bytes = toBytes(input);
  const maxInput = opts.maxInput != null ? Number(opts.maxInput) : DEFAULT_MAX_INPUT;
  const maxOutput = opts.maxOutput != null ? Number(opts.maxOutput) : DEFAULT_MAX_OUTPUT;
  if (!Number.isSafeInteger(maxInput) || maxInput < 0) throw new LzmaError("BAD_OPTION", "maxInput must be a non-negative integer");
  if (!Number.isSafeInteger(maxOutput) || maxOutput < 0) throw new LzmaError("BAD_OPTION", "maxOutput must be a non-negative integer");
  if (bytes.length > maxInput) throw new LzmaError("LIMIT_INPUT", "compressed input exceeds maxInput");

  const format = opts.format || "auto";
  let stream;
  let header;
  let declaredSize = null;

  if (format === "lzma" || (format === "auto" && isLzmaAlone(bytes))) {
    if (bytes.length < 13) throw new LzmaError("TRUNCATED", "LZMA alone header needs 13 bytes");
    header = bytes.subarray(0, 13);
    stream = bytes.subarray(13);
    const propsBytes = header.subarray(0, 5);
    parsePropsBytes(propsBytes);
    const sizeBig = readU64le(header, 5);
    if (sizeBig !== MAX_U64) {
      if (sizeBig > BigInt(Number.MAX_SAFE_INTEGER)) throw new LzmaError("BAD_SIZE", "LZMA size is too large");
      declaredSize = Number(sizeBig);
      if (declaredSize > maxOutput) throw new LzmaError("LIMIT_OUTPUT", "declared output exceeds maxOutput");
    }
    if (stream.length === 0) throw new LzmaError("TRUNCATED", "LZMA stream is empty");
  } else if (format === "raw") {
    if (bytes.length === 0) throw new LzmaError("TRUNCATED", "raw LZMA stream is empty");
    const props = normalizeProps(opts);
    const propsBytes = propsToBytes(props);
    if (opts.size != null) {
      const n = Number(opts.size);
      if (!Number.isSafeInteger(n) || n < 0) throw new LzmaError("BAD_SIZE", "size must be a non-negative integer");
      if (n > maxOutput) throw new LzmaError("LIMIT_OUTPUT", "declared output exceeds maxOutput");
      declaredSize = n;
    }
    header = makeAlone(propsBytes, declaredSize);
    stream = bytes;
  } else {
    throw new LzmaError("BAD_FORMAT", "format must be auto, lzma or raw");
  }

  return withWasm(async (mod) => {
    const FS = mod.FS;
    const id = nextId("lzma_in");
    const file = id + ".lzma";
    const outDir = id + "_out";
    const archive = concatBytes(header, stream);
    try {
      FS.writeFile(file, archive);
      try { FS.mkdir(outDir); } catch { }
      const res = run7z(mod, ["x", file, "-o" + outDir, "-y"]);
      if (res.code !== 0) {
        const tail = res.out.trim().split("\n").slice(-4).join(" | ");
        throw new LzmaError("DECODE_FAILED", "7z extraction failed (exit " + res.code + ")" + (tail ? ": " + tail : ""));
      }
      const files = outputFiles(FS, outDir);
      if (files.length === 0) throw new LzmaError("DECODE_FAILED", "7z produced no output file");
      files.sort((a, b) => a.name.localeCompare(b.name));
      const picked = files[0];
      if (picked.size > maxOutput) throw new LzmaError("LIMIT_OUTPUT", "output exceeds maxOutput");
      if (declaredSize != null && picked.size !== declaredSize) {
        throw new LzmaError("SIZE_MISMATCH", "output size " + picked.size + " != declared " + declaredSize);
      }
      const data = new Uint8Array(FS.readFile(picked.full));
      if (data.length > maxOutput) throw new LzmaError("LIMIT_OUTPUT", "output exceeds maxOutput");
      if (declaredSize != null && data.length !== declaredSize) {
        throw new LzmaError("SIZE_MISMATCH", "output size " + data.length + " != declared " + declaredSize);
      }
      return data;
    } finally {
      try { FS.unlink(file); } catch { }
      fsRmRf(FS, outDir);
    }
  });
}

function readByte(st) {
  if (st.p >= st.end) throw new LzmaError("BAD_7Z", "unexpected end of 7z header");
  return st.b[st.p++];
}

function read7zNumber(st) {
  const first = readByte(st);
  let mask = 0x80;
  let value = 0;
  for (let i = 0; i < 8; i++) {
    if ((first & mask) === 0) {
      value += (first & (mask - 1)) * (2 ** (8 * i));
      if (!Number.isSafeInteger(value)) throw new LzmaError("BAD_7Z", "7z number exceeds safe integer");
      return value;
    }
    value += readByte(st) * (2 ** (8 * i));
    mask >>= 1;
  }
  throw new LzmaError("BAD_7Z", "invalid 7z varint");
}

function skipDigests(st, count) {
  const allDefined = readByte(st);
  if (allDefined) {
    for (let i = 0; i < count; i++) {
      for (let j = 0; j < 4; j++) readByte(st);
    }
    return;
  }
  const bitBytes = (count + 7) >> 3;
  const bits = new Uint8Array(bitBytes);
  for (let i = 0; i < bitBytes; i++) bits[i] = readByte(st);
  for (let i = 0; i < count; i++) {
    if (bits[i >> 3] & (1 << (i & 7))) {
      for (let j = 0; j < 4; j++) readByte(st);
    }
  }
}

function parse7zLzma(bytes) {
  if (bytes.length < 32) throw new LzmaError("BAD_7Z", "7z output is shorter than 32 bytes");
  const magic = [0x37, 0x7A, 0xBC, 0xAF, 0x27, 0x1C];
  for (let i = 0; i < magic.length; i++) {
    if (bytes[i] !== magic[i]) throw new LzmaError("BAD_7Z", "7z output has bad signature");
  }
  if (crc32(bytes, 12, 32) !== u32le(bytes, 8)) throw new LzmaError("BAD_7Z", "7z StartHeader CRC mismatch");
  const nextOff = readU64le(bytes, 12);
  const nextSize = readU64le(bytes, 20);
  if (nextOff > BigInt(Number.MAX_SAFE_INTEGER) || nextSize > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new LzmaError("BAD_7Z", "7z header offset is too large");
  }
  const headerStart = 32 + Number(nextOff);
  const end = headerStart + Number(nextSize);
  if (end > bytes.length) throw new LzmaError("BAD_7Z", "7z next header is truncated");
  if (crc32(bytes, headerStart, end) !== u32le(bytes, 28)) throw new LzmaError("BAD_7Z", "7z NextHeader CRC mismatch");

  const st = { b: bytes, p: headerStart, end };
  if (readByte(st) !== 0x01) throw new LzmaError("BAD_7Z", "7z header id is not kHeader");

  let packPos = null;
  let packSize = null;
  let propsBytes = null;
  let unpackSize = null;

  while (st.p < end) {
    const id = readByte(st);
    if (id === 0x00) break;
    if (id === 0x02) {
      while (true) {
        const pid = readByte(st);
        if (pid === 0) break;
        const size = read7zNumber(st);
        if (st.p + size > st.end) throw new LzmaError("BAD_7Z", "7z archive property is truncated");
        st.p += size;
      }
      continue;
    }
    if (id === 0x03) throw new LzmaError("UNSUPPORTED_7Z", "7z additional streams are not supported");
    if (id === 0x05) break;
    if (id !== 0x04) throw new LzmaError("UNSUPPORTED_7Z", "unexpected 7z header id 0x" + id.toString(16));
    let sid = readByte(st);
    while (sid !== 0x00) {
      if (sid === 0x06) {
        packPos = read7zNumber(st);
        const numPack = read7zNumber(st);
        if (numPack !== 1) throw new LzmaError("UNSUPPORTED_7Z", "expected one 7z pack stream");
        let pid = readByte(st);
        while (pid !== 0x00) {
          if (pid === 0x09) {
            packSize = read7zNumber(st);
          } else if (pid === 0x0A) {
            skipDigests(st, numPack);
          } else {
            throw new LzmaError("UNSUPPORTED_7Z", "unexpected 7z PackInfo id 0x" + pid.toString(16));
          }
          pid = readByte(st);
        }
      } else if (sid === 0x07) {
        const uid = readByte(st);
        if (uid !== 0x0B) throw new LzmaError("UNSUPPORTED_7Z", "7z UnpackInfo missing kFolder");
        const numFolders = read7zNumber(st);
        if (numFolders !== 1) throw new LzmaError("UNSUPPORTED_7Z", "expected one 7z folder");
        if (readByte(st) !== 0) throw new LzmaError("UNSUPPORTED_7Z", "external 7z folders are not supported");
        const numCoders = read7zNumber(st);
        if (numCoders !== 1) throw new LzmaError("UNSUPPORTED_7Z", "expected one 7z coder");
        const flags = readByte(st);
        if (flags & 0x10) throw new LzmaError("UNSUPPORTED_7Z", "complex 7z coder is not supported");
        const idSize = flags & 0x0F;
        const method = [];
        for (let i = 0; i < idSize; i++) method.push(readByte(st));
        if (flags & 0x20) {
          const size = read7zNumber(st);
          propsBytes = new Uint8Array(size);
          for (let i = 0; i < size; i++) propsBytes[i] = readByte(st);
        }
        if (method.length !== 3 || method[0] !== 0x03 || method[1] !== 0x01 || method[2] !== 0x01) {
          throw new LzmaError("UNSUPPORTED_7Z", "7z coder is not LZMA1");
        }
        let pid = readByte(st);
        while (pid !== 0x00) {
          if (pid === 0x0C) {
            unpackSize = read7zNumber(st);
            break;
          }
          if (pid === 0x0A) {
            skipDigests(st, 1);
            pid = readByte(st);
            continue;
          }
          throw new LzmaError("UNSUPPORTED_7Z", "unexpected 7z UnpackInfo id 0x" + pid.toString(16));
        }
        if (packPos == null) throw new LzmaError("BAD_7Z", "missing 7z PackInfo");
        if (packSize == null) throw new LzmaError("BAD_7Z", "missing 7z pack size");
        if (!propsBytes || propsBytes.length !== 5) throw new LzmaError("BAD_7Z", "missing LZMA properties in 7z");
        if (unpackSize == null) throw new LzmaError("BAD_7Z", "missing 7z unpack size");
        const packedStart = 32 + packPos;
        if (packedStart + packSize > bytes.length) throw new LzmaError("BAD_7Z", "7z packed stream is truncated");
        return {
          packed: bytes.subarray(packedStart, packedStart + packSize),
          propsBytes,
          unpackSize,
        };
      } else {
        throw new LzmaError("UNSUPPORTED_7Z", "unexpected 7z StreamsInfo id 0x" + sid.toString(16));
      }
      sid = readByte(st);
    }
  }
  throw new LzmaError("BAD_7Z", "7z archive has no LZMA main stream");
}

async function encodeInternal(data, opts) {
  const maxInput = opts.maxInput != null ? Number(opts.maxInput) : DEFAULT_MAX_INPUT;
  if (!Number.isSafeInteger(maxInput) || maxInput < 0) throw new LzmaError("BAD_OPTION", "maxInput must be a non-negative integer");
  if (data.length > maxInput) throw new LzmaError("LIMIT_INPUT", "input exceeds maxInput");

  if (data.length === 0) {
    const propsBytes = propsToBytes(EMPTY_PROPS);
    return {
      alone: concatBytes(makeAlone(propsBytes, null), EMPTY_RAW),
      raw: new Uint8Array(EMPTY_RAW),
      props: { ...EMPTY_PROPS },
      size: 0,
    };
  }

  const preset = opts.preset != null ? Number(opts.preset) : 5;
  if (!Number.isInteger(preset) || preset < 0 || preset > 9) throw new LzmaError("BAD_OPTION", "preset must be 0..9");
  const dictSize = opts.dictSize != null ? Number(opts.dictSize) : null;
  if (dictSize != null && (!Number.isInteger(dictSize) || dictSize < 4096 || dictSize > 0xFFFFFFFF)) {
    throw new LzmaError("BAD_OPTION", "invalid dictSize");
  }

  return withWasm(async (mod) => {
    const FS = mod.FS;
    const id = nextId("lzma_out");
    const inputFile = id + ".bin";
    const archiveFile = id + ".7z";
    try {
      FS.writeFile(inputFile, data);
      const argv = ["a", "-t7z", "-m0=lzma", "-mhc=off", "-mx=" + preset];
      if (dictSize != null) argv.push("-md=" + dictSize + "b");
      argv.push(archiveFile, inputFile);
      const res = run7z(mod, argv);
      if (res.code !== 0) {
        const tail = res.out.trim().split("\n").slice(-4).join(" | ");
        throw new LzmaError("ENCODE_FAILED", "7z creation failed (exit " + res.code + ")" + (tail ? ": " + tail : ""));
      }
      let st;
      try { st = FS.stat(archiveFile); } catch { throw new LzmaError("ENCODE_FAILED", "7z produced no archive"); }
      if (!st.size) throw new LzmaError("ENCODE_FAILED", "7z produced an empty archive");
      const archive = new Uint8Array(FS.readFile(archiveFile));
      const parsed = parse7zLzma(archive);
      if (parsed.unpackSize !== data.length) {
        throw new LzmaError("ENCODE_FAILED", "7z unpack size " + parsed.unpackSize + " != input " + data.length);
      }
      if (!parsed.packed.length) throw new LzmaError("ENCODE_FAILED", "7z produced an empty LZMA stream");
      const props = parsePropsBytes(parsed.propsBytes);
      const alone = new Uint8Array(13 + parsed.packed.length);
      alone.set(makeAlone(parsed.propsBytes, data.length), 0);
      alone.set(parsed.packed, 13);
      return {
        alone,
        raw: new Uint8Array(parsed.packed),
        props,
        size: data.length,
      };
    } finally {
      try { FS.unlink(inputFile); } catch { }
      try { FS.unlink(archiveFile); } catch { }
    }
  });
}

export async function lzmaEncode(input, opts = {}) {
  const data = toBytes(input);
  const out = await encodeInternal(data, opts);
  return out.alone;
}

export async function lzmaEncodeRaw(input, opts = {}) {
  const data = toBytes(input);
  const out = await encodeInternal(data, opts);
  return { bytes: out.raw, props: out.props, size: out.size };
}

export {
  isLzmaAlone,
  normalizeProps,
  propsToBytes,
  parsePropsBytes,
  lzmaWasmAvailable,
  lzmaWasmError,
};
