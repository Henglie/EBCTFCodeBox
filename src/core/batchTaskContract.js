import { normalizeInput, inputBytes, inputError } from './inputContract.js';
import { parseProductDataUrl } from './productResult.js';

export const TASK_SCHEMA_VERSION = 1;
export const BATCH_TASK_LIMITS = Object.freeze({ maxTasks: 200, maxInputBytes: 8 * 1024 * 1024, maxTotalInputBytes: 32 * 1024 * 1024, maxTextBytes: 8 * 1024 * 1024,
  maxFiles: 200, maxFileBytes: 8 * 1024 * 1024, maxTotalBytes: 32 * 1024 * 1024 });
// An explicit rollout scope, not a heuristic claim that every registered op works.
// Every id below passed tools/batch_rollout_probe.mjs (batch == single == sourced expectation).
export const BATCH_TASK_OPS = Object.freeze(['base64', 'md5', 'aes', 'rsaModpow', 'rsaCrt', 'babaiCvp', 'diffTool', 'gifFrames',
  'sha1', 'sha256', 'sha384', 'sha512', 'sha3', 'ripemd160', 'blake2b', 'sm3', 'whirlpool', 'md4', 'crc32', 'hmac',
  'base16', 'base32', 'base36', 'base45', 'base58', 'base62', 'base85', 'base91', 'base92', 'base100', 'crockford32', 'z85',
  'caesar', 'vigenere', 'railFence', 'scytale', 'gronsfeld', 'beaufort', 'affine', 'atbash', 'playfair', 'autokey', 'bifid', 'columnar',
  'url', 'htmlEntity', 'unicodeEscape', 'quotedPrintable', 'uuencode', 'xxencode', 'punycode', 'morse', 'bacon', 'rot13', 'rot47', 'a1z26',
  'des', 'des3', 'blowfish', 'rc4', 'chacha20', 'salsa20', 'xor', 'sm4', 'tea', 'xtea', 'xxtea', 'rabbit']);
const encoder = new TextEncoder();
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const fail = (code, message) => { throw inputError(code, message); };

export function taskLimits(overrides = {}) {
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) fail('TASK_LIMIT', 'Limits must be an object');
  const out = { ...BATCH_TASK_LIMITS };
  for (const [key, value] of Object.entries(overrides)) {
    if (!own(out, key) || !Number.isSafeInteger(value) || value < 0) fail('TASK_LIMIT', 'Invalid limit: ' + key);
    out[key] = value;
  }
  return out;
}
export function taskDataSize(value, seen = new Set()) {
  if (typeof value === 'string') return encoder.encode(value).byteLength;
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return value.byteLength;
  if (!value || typeof value !== 'object') return 0;
  if (seen.has(value)) return 0;
  seen.add(value);
  return Object.entries(value).reduce((sum, [key, v]) => sum + encoder.encode(key).byteLength + taskDataSize(v, seen), 0);
}
export function normalizeTask(op, request, options = {}) {
  if (!request || typeof request.taskId !== 'string' || !request.taskId || request.taskId.length > 128 || /[\x00-\x1f\x7f]/.test(request.taskId)) fail('TASK_ID', 'A nonempty taskId of at most 128 characters is required');
  const attempt = request.attempt ?? 1;
  if (!Number.isSafeInteger(attempt) || attempt < 1) fail('TASK_ATTEMPT', 'attempt must be a positive safe integer');
  // options.rollout is a verification-harness override; execution hosts never pass it.
  const rollout = Array.isArray(options.rollout) ? options.rollout : BATCH_TASK_OPS;
  if (!rollout.includes(op?.id)) fail('TASK_UNSUPPORTED', 'Operation is outside the verified batch rollout: ' + op?.id);
  const limits = taskLimits(options.limits);
  // Check the original memory payload before copying it into the canonical task.
  if (taskDataSize(request) > limits.maxInputBytes) fail('TASK_INPUT_BUDGET', 'Task input and parameters exceed the input budget');
  const normalized = normalizeInput(op, request);
  delete normalized.params._allowLimitOverride;
  if (options.allowOverLimit === true) normalized.params._allowLimitOverride = true;
  return { ...normalized, taskId: request.taskId, attempt };
}
export function taskFailure(task, error, status = 'error') {
  if (!['error', 'cancelled', 'timeout', 'skipped'].includes(status)) fail('RESULT_STATUS', 'Invalid failure status');
  const e = error instanceof Error ? error : inputError('TASK_ERROR', typeof error === 'string' ? error : 'Task failed');
  return { schemaVersion: TASK_SCHEMA_VERSION, taskId: task.taskId, attempt: task.attempt ?? 1, opId: task.opId,
    status, text: '', files: [], error: { code: e.code || 'TASK_ERROR', message: e.message, ...(e.meta ? { meta: e.meta } : {}) }, omitted: [], budget: { usedBytes: 0, usedFiles: 0 } };
}

/** A result is complete inside its budget; any dropped content makes it an error. */
export function normalizeTaskResult(task, value, options = {}) {
  const limits = taskLimits(options.limits);
  const result = { schemaVersion: TASK_SCHEMA_VERSION, taskId: task.taskId, attempt: task.attempt ?? 1, opId: task.opId,
    status: 'ok', text: '', files: [], error: null, omitted: [], budget: { usedBytes: 0, usedFiles: 0 } };
  let files = [];
  const isBytes = value instanceof ArrayBuffer || ArrayBuffer.isView(value);
  if (typeof value === 'string') result.text = value;
  else if (isBytes) files = [{ name: 'result.bin', bytes: value }];
  else if (value && typeof value === 'object' && !Array.isArray(value) && (own(value, 'text') || own(value, 'files'))) {
    if (own(value, 'text') && typeof value.text !== 'string') fail('RESULT_TEXT', 'Product text must be a string');
    if (own(value, 'files') && !Array.isArray(value.files)) fail('RESULT_FILES', 'Product files must be an array');
    result.text = value.text ?? ''; files = value.files ?? [];
    if (value.error || value.status === 'error') {
      result.status = 'error'; result.error = { code: 'RESULT_ERROR', message: typeof value.error === 'string' ? value.error : 'Operation returned an error' };
    }
  } else if (value !== undefined && value !== null) {
    try {
      const validate = (v, stack = new Set()) => {
        if (v === null || typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v))) return;
        if (!v || typeof v !== 'object' || stack.has(v) || (!Array.isArray(v) && ![Object.prototype, null].includes(Object.getPrototypeOf(v)))) fail('RESULT_TYPE', 'Expected plain finite JSON data');
        stack.add(v); for (const member of Object.values(v)) validate(member, stack); stack.delete(v);
      };
      validate(value);
      // Preserve plain JSON as data as well as its readable representation.
      const json = JSON.stringify(value, (_key, v) => {
        if (typeof v === 'function' || typeof v === 'symbol' || typeof v === 'undefined' || typeof v === 'bigint' || (typeof v === 'number' && !Number.isFinite(v))) fail('RESULT_TYPE', 'Unsupported JSON result member');
        return v;
      });
      if (json === undefined) fail('RESULT_TYPE', 'Unsupported operation result');
      result.text = json;
      if (encoder.encode(json).byteLength <= Math.min(limits.maxTextBytes, limits.maxTotalBytes)) result.json = JSON.parse(json);
    } catch (e) { fail('RESULT_TYPE', e.message); }
  } else fail('RESULT_TYPE', 'Null/undefined operation results are not successful output');
  const textBytes = encoder.encode(result.text).byteLength;
  if (textBytes > limits.maxTextBytes || textBytes > limits.maxTotalBytes) {
    result.text = ''; result.omitted.push({ kind: 'text', bytes: textBytes, reason: 'RESULT_BUDGET' });
  } else result.budget.usedBytes = textBytes;
  const count = Math.min(files.length, limits.maxFiles);
  for (let i = 0; i < count; i++) {
    const file = files[i];
    try {
      if (!file || typeof file !== 'object' || (!own(file, 'bytes') && !own(file, 'dataUrl'))) fail('RESULT_FILE', 'File requires bytes or dataUrl');
      const name = file.name ?? `file-${i + 1}.bin`;
      if (typeof name !== 'string' || !name || /[\x00-\x1f\x7f]/.test(name)) fail('RESULT_FILE_NAME', 'Invalid product filename');
      let bytes, inferredMime;
      if (own(file, 'bytes')) {
        const n = Array.isArray(file.bytes) ? file.bytes.length : file.bytes?.byteLength;
        if (!Number.isSafeInteger(n) || n > limits.maxFileBytes || n + result.budget.usedBytes > limits.maxTotalBytes) fail('RESULT_BUDGET', 'File exceeds output budget');
        bytes = inputBytes(file.bytes);
      } else {
        if (typeof file.dataUrl !== 'string' || file.dataUrl.length > limits.maxFileBytes * 4 + 1024) fail('RESULT_BUDGET', 'Encoded data URL exceeds output budget');
        const parsed = parseProductDataUrl(file.dataUrl); bytes = parsed.bytes; inferredMime = parsed.mime;
      }
      const mime = file.mime ?? inferredMime ?? 'application/octet-stream';
      if (typeof mime !== 'string' || /[\r\n\x00]/.test(mime)) fail('RESULT_MIME', 'Invalid product MIME');
      if (bytes.byteLength > limits.maxFileBytes || bytes.byteLength + result.budget.usedBytes > limits.maxTotalBytes) fail('RESULT_BUDGET', 'File exceeds output budget');
      result.files.push({ name, mime, bytes, size: bytes.byteLength });
      result.budget.usedBytes += bytes.byteLength; result.budget.usedFiles++;
    } catch (error) { result.omitted.push({ index: i, reason: error.code || 'RESULT_FILE', message: error.message }); }
  }
  if (files.length > count) result.omitted.push({ index: count, count: files.length - count, reason: 'RESULT_FILE_COUNT' });
  if (result.omitted.length) { result.status = 'error'; result.error = { code: 'RESULT_INCOMPLETE', message: 'Output is incomplete; see omitted entries' }; }
  return result;
}
