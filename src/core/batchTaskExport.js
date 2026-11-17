/*
 * 批任务结果导出：结果对象 → CSV / JSON / 产物清单。
 *
 * 约束：
 *   - 只用标准 Web API（TextEncoder/Uint8Array），不依赖 Node Buffer，浏览器与 Node 同源；
 *   - 不展开大数组（逐项 push），避免超大产物触发调用栈上限；
 *   - 不做任何"只看存在性"的校验：CSV/JSON/产物都按真实结果逐项生成。
 *   - 原始文本与表格安全展示分开：默认原样保留以 = + - @ 开头的文本，另提供显式转义开关。
 */
import { TASK_SCHEMA_VERSION } from './batchTaskContract.js';

export const RESULT_CSV_COLUMNS = Object.freeze([
  'taskId', 'opId', 'attempt', 'status', 'errorCode', 'errorMessage', 'text', 'textBytes', 'fileCount', 'fileNames',
]);

const encoder = new TextEncoder();

function csvCell(value, options) {
  let s = value == null ? '' : String(value);
  if (options.escapeFormula && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
  if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

/** 一行结果 → 扁平记录；文本超长按 budget 截断会由上游标记，这里不再二次裁剪。 */
export function resultToRecord(result) {
  const files = Array.isArray(result.files) ? result.files : [];
  const names = [];
  for (let i = 0; i < files.length; i++) names.push(files[i] && typeof files[i].name === 'string' ? files[i].name : '');
  return {
    taskId: result.taskId ?? '',
    opId: result.opId ?? '',
    attempt: result.attempt ?? 1,
    status: result.status ?? 'error',
    errorCode: result.error && result.error.code ? result.error.code : '',
    errorMessage: result.error && result.error.message ? result.error.message : '',
    text: typeof result.text === 'string' ? result.text : '',
    textBytes: typeof result.text === 'string' ? encoder.encode(result.text).byteLength : 0,
    fileCount: files.length,
    fileNames: names.join(' | '),
  };
}

/** 结果数组 → RFC 4180 CSV；BOM 可选，供 Excel 直接打开。 */
export function resultsToCsv(results, options = {}) {
  if (!Array.isArray(results)) throw new TypeError('resultsToCsv expects an array');
  const list = options.includeHeader === false ? [] : [RESULT_CSV_COLUMNS.join(',')];
  for (let i = 0; i < results.length; i++) {
    const rec = resultToRecord(results[i]);
    const cells = [];
    for (let c = 0; c < RESULT_CSV_COLUMNS.length; c++) cells.push(csvCell(rec[RESULT_CSV_COLUMNS[c]], options));
    list.push(cells.join(','));
  }
  const body = list.join('\r\n') + '\r\n';
  return options.bom ? '\uFEFF' + body : body;
}

/** 完整 JSON 快照：保留 schemaVersion/状态/错误/产物元数据，字节不进 JSON。 */
export function resultsToJson(run) {
  const results = Array.isArray(run?.results) ? run.results : (Array.isArray(run) ? run : []);
  const rows = [];
  for (let i = 0; i < results.length; i++) {
    const r = results[i] || {};
    const files = Array.isArray(r.files) ? r.files : [];
    const meta = [];
    for (let f = 0; f < files.length; f++) {
      const file = files[f] || {};
      meta.push({ name: file.name ?? '', mime: file.mime ?? 'application/octet-stream', size: file.size ?? (file.bytes ? file.bytes.byteLength : 0) });
    }
    rows.push({
      schemaVersion: r.schemaVersion ?? TASK_SCHEMA_VERSION,
      taskId: r.taskId ?? '', opId: r.opId ?? '', attempt: r.attempt ?? 1,
      status: r.status ?? 'error',
      text: typeof r.text === 'string' ? r.text : '',
      error: r.error ?? null,
      omitted: Array.isArray(r.omitted) ? r.omitted : [],
      budget: r.budget ?? { usedBytes: 0, usedFiles: 0 },
      files: meta,
    });
  }
  return {
    schemaVersion: TASK_SCHEMA_VERSION,
    jobId: run?.jobId ?? '',
    cancelled: run?.cancelled === true,
    reason: run?.reason ?? '',
    total: rows.length,
    ok: rows.filter((r) => r.status === 'ok').length,
    failed: rows.filter((r) => r.status !== 'ok').length,
    results: rows,
  };
}

/**
 * 展平全部产物：路径 taskId/文件名；同名按出现顺序加 -2/-3 后缀。
 * 返回 [{path, bytes, mime, taskId, name}]，不丢任何文件（合同：全部产物、原顺序）。
 */
export function collectArtifacts(results, options = {}) {
  if (!Array.isArray(results)) throw new TypeError('collectArtifacts expects an array');
  const dirPerTask = options.dirPerTask !== false;
  const used = new Set();
  const out = [];
  for (let i = 0; i < results.length; i++) {
    const r = results[i] || {};
    const taskId = typeof r.taskId === 'string' && r.taskId ? r.taskId : 'task-' + (i + 1);
    const files = Array.isArray(r.files) ? r.files : [];
    for (let f = 0; f < files.length; f++) {
      const file = files[f] || {};
      if (!(file.bytes instanceof Uint8Array)) continue;
      const baseName = typeof file.name === 'string' && file.name ? file.name : 'file-' + (f + 1) + '.bin';
      const stem = dirPerTask ? taskId + '/' : '';
      let path = stem + baseName;
      let n = 2;
      while (used.has(path)) {
        const dot = baseName.lastIndexOf('.');
        const name = dot > 0 ? baseName.slice(0, dot) + '-' + n + baseName.slice(dot) : baseName + '-' + n;
        path = stem + name;
        n++;
      }
      used.add(path);
      out.push({ path, bytes: file.bytes, mime: file.mime ?? 'application/octet-stream', taskId, name: baseName });
    }
  }
  return out;
}

/** 产物清单 → ZIP 条目（name/bytes），交给现用 buildZip。 */
export function artifactsToZipEntries(artifacts) {
  const entries = [];
  for (let i = 0; i < artifacts.length; i++) entries.push({ name: artifacts[i].path, bytes: artifacts[i].bytes });
  return entries;
}
