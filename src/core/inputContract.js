// Versioned invocation data; no registry, UI or execution-host dependency.
import { bytesToHex } from './bytesIo.js';
export const INPUT_SCHEMA_VERSION = 1;
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
export function inputError(code, message) { return Object.assign(new Error(message), { code }); }
function fail(code, message) { throw inputError(code, message); }
function record(value, label) {
  if (!value || typeof value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail('INPUT_OBJECT', label + ' must be a plain object');
  for (const key of Object.keys(value)) if (['__proto__', 'prototype', 'constructor'].includes(key)) fail('INPUT_KEY', 'Reserved key: ' + key);
  return value;
}
export function inputBytes(value) {
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) if (!own(value, i) || !Number.isInteger(value[i]) || value[i] < 0 || value[i] > 255) return fail('INPUT_BYTES', 'Byte arrays require explicit integers in 0..255');
    return Uint8Array.from(value);
  }
  return fail('INPUT_BYTES', 'Expected byte array or ArrayBuffer view');
}
export function relativeInputPath(value) {
  if (typeof value !== 'string' || !value || /[\x00-\x1f\x7f\\:]/.test(value) || value.startsWith('/') || value.split('/').some(s => !s || s === '.' || s === '..')) fail('INPUT_PATH', 'Expected a relative selected-file path');
  return value;
}
function copy(value, stack = new Set()) {
  if (value == null || ['string', 'boolean', 'bigint'].includes(typeof value)) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return inputBytes(value);
  if (typeof value !== 'object' || stack.has(value)) fail('INPUT_VALUE', 'Parameters must contain finite cloneable data without cycles');
  stack.add(value);
  if (!Array.isArray(value)) record(value, 'parameter');
  const result = Array.isArray(value) ? value.map(v => copy(v, stack)) : Object.fromEntries(Object.entries(value).map(([k, v]) => [k, copy(v, stack)]));
  stack.delete(value); return result;
}
function selectedFiles(entries) {
  if (!Array.isArray(entries)) fail('INPUT_FILES', 'files must be an array');
  const index = new Map();
  for (const entry of entries) {
    record(entry, 'file'); const path = relativeInputPath(entry.path);
    if (index.has(path)) fail('INPUT_FILE_AMBIGUOUS', 'Duplicate selected path: ' + path);
    const file = slot('bytes', entry.bytes, { name: entry.name ?? path.split('/').pop(), mime: entry.mime }, new Map());
    index.set(path, { path, name: file.name, mime: file.mime, bytes: file.value });
  }
  return index;
}
function slot(kind, value, info, files) {
  if (kind === 'file') {
    const path = relativeInputPath(value), file = files.get(path);
    if (!file) fail('INPUT_FILE_MISSING', 'File was not selected: ' + path);
    return { kind: 'bytes', value: inputBytes(file.bytes), name: file.name, mime: file.mime, path };
  }
  if (kind === 'bytes') {
    const name = info.name ?? 'input.bin', mime = info.mime ?? 'application/octet-stream';
    if (typeof name !== 'string' || !name || /[\x00-\x1f\x7f]/.test(name) || typeof mime !== 'string' || /[\r\n\x00]/.test(mime)) fail('INPUT_METADATA', 'Invalid file name or MIME');
    return { kind, value: inputBytes(value), name, mime };
  }
  if (kind !== 'text' || typeof value !== 'string') fail('INPUT_TYPE', 'Text input must be an explicit string');
  return { kind: 'text', value, encoding: info.encoding ?? 'utf8' };
}

/** Missing properties use defaults; explicit empty/false/zero never do. */
export function normalizeInput(op, request = {}) {
  record(request, 'request');
  if (!op || typeof op.id !== 'string') fail('INPUT_OP', 'Operation metadata required');
  if (own(request, 'schemaVersion') && request.schemaVersion !== INPUT_SCHEMA_VERSION) fail('INPUT_VERSION', 'Unsupported input schema');
  if (own(request, 'opId') && request.opId !== op.id) fail('INPUT_OP', 'Operation identity mismatch');
  const direction = own(request, 'direction') ? request.direction : (typeof op.run === 'function' ? 'run' : typeof op.encode === 'function' ? 'encode' : 'decode');
  if (!['run', 'encode', 'decode'].includes(direction) || typeof op[direction] !== 'function') fail('INPUT_DIRECTION', 'Unsupported direction: ' + direction);
  const supplied = record(own(request, 'params') ? request.params : {}, 'params');
  const params = Object.fromEntries((op.params || []).filter(p => p.default !== undefined).map(p => [p.key, copy(p.default)]));
  for (const [key, value] of Object.entries(supplied)) if (key !== 'rawBytes' && key !== 'rawFileName') params[key] = copy(value);
  const files = selectedFiles(own(request, 'files') ? request.files : []);
  const explicitInput = own(request, 'input') || own(request, 'inputKind');
  const inputKind = request.inputKind ?? (explicitInput ? 'text' : supplied.rawBytes != null ? 'bytes' : 'text');
  let primary;
  if (inputKind === 'none') {
    if (own(request, 'input') && request.input !== '' && request.input !== null) fail('INPUT_NONE', 'No-input invocation cannot discard a supplied value');
    primary = { kind: 'none', value: '' };
  } else {
    const value = explicitInput ? (own(request, 'input') ? request.input : fail('INPUT_MISSING', 'input is required for inputKind')) : supplied.rawBytes != null ? supplied.rawBytes : '';
    primary = slot(inputKind, value, { name: request.fileName ?? supplied.rawFileName, mime: request.mime, encoding: request.encoding }, files);
    if (primary.kind === 'text' && primary.encoding !== 'utf8') fail('INPUT_ENCODING', 'Primary text is literal UTF-8; use bytes or operation encoding parameters explicitly');
  }
  const fieldValues = record(own(request, 'fields') ? request.fields : {}, 'fields'), fields = {};
  for (const [key, value] of Object.entries(fieldValues)) {
    if (typeof value === 'string') fields[key] = slot('text', value, {}, files);
    else { record(value, 'field'); fields[key] = slot(value.kind, value.value, value, files); }
  }
  // This alias is explicit and operation-specific, never guessed from param names.
  if (op.id === 'diffTool' && !own(fields, 'textB') && own(params, 'textB')) fields.textB = slot('text', params.textB, {}, files);
  return { schemaVersion: INPUT_SCHEMA_VERSION, opId: op.id, direction, inputKind: primary.kind, input: primary.value,
    fileName: primary.name, mime: primary.mime, fields, params };
}

/** Bridge to current signatures. Unsupported field adapters fail before running. */
export function legacyInvocation(op, normalized) {
  const p = copy(normalized.params), fields = normalized.fields;
  let text = normalized.inputKind === 'text' ? normalized.input : '';
  if (normalized.inputKind === 'bytes') {
    if (op.acceptsBytes !== true) fail('INPUT_BYTE_ADAPTER', 'Operation has no declared byte-input adapter');
    p.rawBytes = inputBytes(normalized.input); p.rawFileName = normalized.fileName;
    // Hex is a lossless display only; the operation consumes rawBytes.
    text = bytesToHex(p.rawBytes);
  }
  const names = Object.keys(fields);
  if (op.id === 'diffTool') {
    if (names.some(key => !['A', 'B', 'textB'].includes(key))) fail('INPUT_FIELD_UNKNOWN', 'Unknown diff field');
    if (own(fields, 'textB')) {
      if (fields.textB.kind !== 'text' || fields.textB.encoding !== 'utf8') fail('INPUT_FIELD_ADAPTER', 'The legacy B channel is literal UTF-8 text; use field B for bytes');
      p.textB = fields.textB.value;
    }
    // Equal-rank A/B slots go to the algorithm untouched. An empty text slot equals the legacy
    // default (empty input / empty textB), so it is treated as absent rather than as a second source.
    const slots = {};
    for (const key of ['A', 'B']) {
      if (!own(fields, key)) continue;
      const value = fields[key];
      if (value.kind === 'text') {
        if (value.encoding !== 'utf8') fail('INPUT_FIELD_ADAPTER', 'Field text is literal UTF-8; use a bytes slot or the inputEnc parameter');
        if (value.value !== '') slots[key] = { kind: 'text', value: value.value };
      } else slots[key] = { kind: 'bytes', value: inputBytes(value.value) };
    }
    if (own(slots, 'A') && (normalized.inputKind === 'bytes' || text !== '')) fail('INPUT_CONFLICT', 'Field A and the primary input cannot both be supplied');
    if (own(slots, 'B')) {
      if (p.textB != null && p.textB !== '' && !(slots.B.kind === 'text' && slots.B.value === p.textB)) fail('INPUT_CONFLICT', 'Field B and textB cannot both be supplied');
      delete p.textB;
    }
    if (Object.keys(slots).length) p.fields = slots;
  } else if (op.fieldsMode === 'slots' && Array.isArray(op.fields) && names.length) {
    const allowed = new Map(op.fields.map(field => [field.key, field]));
    const slots = {};
    for (const key of names) {
      const descriptor = allowed.get(key), value = fields[key];
      if (!descriptor) fail('INPUT_FIELD_UNKNOWN', 'Unknown structured field: ' + key);
      if (!descriptor.accepts?.includes(value.kind) || (value.kind === 'text' && value.encoding !== 'utf8')) {
        fail('INPUT_FIELD_ADAPTER', 'Unsupported slot type or encoding: ' + key);
      }
      slots[key] = value.kind === 'text' ? { kind: 'text', value: value.value }
        : { kind: 'bytes', value: inputBytes(value.value), name: value.name, mime: value.mime };
    }
    p.fields = slots;
  } else if (Array.isArray(op.fields) && names.length) {
    const keys = op.fields.map(f => f.key), join = op.fieldsJoin ?? '\n';
    if (names.some(key => !keys.includes(key))) fail('INPUT_FIELD_UNKNOWN', 'Unknown structured field');
    if (normalized.inputKind !== 'text' || normalized.input !== '') fail('INPUT_CONFLICT', 'Primary and structured inputs cannot be implicitly combined');
    text = keys.map(key => {
      if (!own(fields, key)) fail('INPUT_FIELD_MISSING', 'Missing field: ' + key);
      const value = fields[key];
      const matrix = op.id === 'babaiCvp' && key === 'basis';
      if (value.kind !== 'text' || value.encoding !== 'utf8' || /\r/.test(value.value) || (!matrix && (/\n/.test(value.value) || (join && value.value.includes(join))))) fail('INPUT_FIELD_ADAPTER', 'Legacy joined fields cannot preserve embedded separators');
      return value.value;
    }).join(join);
  } else if (names.length) fail('INPUT_FIELD_ADAPTER', 'Operation has no structured field adapter');
  return { opId: normalized.opId, direction: normalized.direction, input: text, params: p };
}
