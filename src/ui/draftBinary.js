// Store selected files as portable byte records. Some WebKit hosts can read a
// File but abort IndexedDB transactions that contain the File/Blob itself.
const FILE_KIND = 'ebctf-draft-file-v1';
const files = new WeakMap();
const plain = value => Array.isArray(value) || Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null;

export async function encodeDraftFiles(value, seen = new WeakMap()) {
  if (!value || typeof value !== 'object') return value;
  if (value instanceof Blob) {
    if (!files.has(value)) {
      const pending = Blob.prototype.arrayBuffer.call(value).then(buffer => ({
        kind: FILE_KIND, name: typeof value.name === 'string' ? value.name : null,
        type: value.type, size: value.size, lastModified: value.lastModified || 0, bytes: new Uint8Array(buffer),
      })).catch(error => { files.delete(value); throw error; });
      files.set(value, pending);
    }
    return files.get(value);
  }
  if (!plain(value)) return value;
  if (seen.has(value)) return seen.get(value);
  const result = Array.isArray(value) ? [] : {};
  seen.set(value, result);
  await Promise.all(Object.entries(value).map(async ([key, child]) => {
    Object.defineProperty(result, key, { value: await encodeDraftFiles(child, seen), enumerable: true, configurable: true, writable: true });
  }));
  return result;
}

export function decodeDraftFiles(value, seen = new WeakMap()) {
  if (!value || typeof value !== 'object') return value;
  if (seen.has(value)) return seen.get(value);
  if (value.kind === FILE_KIND && value.bytes instanceof Uint8Array) {
    const file = value.name != null && typeof File === 'function'
      ? new File([value.bytes], value.name, { type: value.type, lastModified: value.lastModified })
      : new Blob([value.bytes], { type: value.type });
    seen.set(value, file);
    return file;
  }
  if (!plain(value)) return value;
  const result = Array.isArray(value) ? [] : {};
  seen.set(value, result);
  for (const [key, child] of Object.entries(value)) Object.defineProperty(result, key, { value: decodeDraftFiles(child, seen), enumerable: true, configurable: true, writable: true });
  return result;
}
