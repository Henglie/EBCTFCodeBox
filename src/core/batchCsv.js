/*
 * 批任务 CSV 合同 v1：CSV 表头 ↔ canonical Task 的纯数据转换。
 *
 * 不依赖 registry / UI / 执行宿主：schema 由调用方注入，便于独立对拍。
 * 三条硬约束（来自冻结合同 CSV 段）：
 *   1) 模板只放 RFC4180 表头与样例行，字段说明是独立对象，绝不写进数据文件；
 *   2) 表头存在的空单元格就是显式空值，保持空；只有缺列才使用声明默认值；
 *   3) 类型只来自冻结列定义，文本与整数样字符串不做猜测。
 */
import { TASK_SCHEMA_VERSION } from './batchTaskContract.js';
import { inputError } from './inputContract.js';

export const CSV_SCHEMA_VERSION = 1;
export const CSV_BASE_COLUMNS = Object.freeze(['taskId', 'opId', 'direction', 'inputKind', 'input', 'encoding']);
export const CSV_FIELD_PREFIX = 'field.';
export const CSV_PARAM_PREFIX = 'param.';

const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const fail = (code, message, extra) => {
  const e = inputError(code, message);
  if (extra) e.meta = extra;
  throw e;
};

/** RFC 4180 严格切分：引号/双引号转义/CRLF/嵌入换行/BOM；不做任何类型猜测。 */
export function splitCsvRows(text) {
  let s = String(text ?? '');
  const hadBom = s.charCodeAt(0) === 0xfeff;
  if (hadBom) s = s.slice(1);
  const rows = [];
  const errors = [];
  let row = [];
  let cell = '';
  let quoted = false;
  let inQuotes = false;
  let closedQuote = false;
  let line = 1;
  let rowLine = 1;

  const pushCell = () => {
    row.push({ value: cell, quoted });
    cell = '';
    quoted = false;
    closedQuote = false;
  };
  const pushRow = () => {
    pushCell();
    rows.push({ cells: row, line: rowLine });
    row = [];
    rowLine = line;
  };

  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') { cell += '"'; i++; }
        else { inQuotes = false; closedQuote = true; }
      } else {
        cell += ch;
        if (ch === '\n') line++;
      }
      continue;
    }
    if (closedQuote && ch !== ',' && ch !== '\r' && ch !== '\n') {
      errors.push({ line, column: row.length + 1, code: 'CSV_AFTER_QUOTE', message: 'Unexpected character after a closing quote' });
      closedQuote = false;
    }
    if (ch === '"') {
      if (cell === '' && !quoted) { inQuotes = true; quoted = true; }
      else {
        errors.push({ line, column: row.length + 1, code: 'CSV_STRAY_QUOTE', message: 'Quote inside an unquoted field' });
        cell += ch;
      }
    } else if (ch === ',') {
      pushCell();
    } else if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      line++;
      pushRow();
    } else {
      cell += ch;
    }
  }
  if (inQuotes) errors.push({ line: rowLine, column: row.length + 1, code: 'CSV_UNCLOSED_QUOTE', message: 'Unclosed quoted field' });
  if (cell !== '' || row.length > 0 || inQuotes) pushRow();
  return { rows, errors, meta: { hadBom, lineEnding: /\r\n/.test(s) ? 'CRLF' : /\n/.test(s) ? 'LF' : 'none' } };
}

const isBlankRow = (row) => row.cells.length === 1 && row.cells[0].value === '' && !row.cells[0].quoted;

/** 解析为表头 + 数据行；表头原样使用（含首尾空格），未知列由 tasksFromCsv 报错。 */
export function parseCsvTable(text) {
  const parsed = splitCsvRows(text);
  if (!parsed.rows.length) fail('CSV_EMPTY', 'CSV has no header row');
  const headerRow = parsed.rows[0];
  const header = headerRow.cells.map((c) => c.value);
  if (header.every((h) => h === '')) fail('CSV_NO_HEADER', 'CSV header row is empty');
  const duplicates = header.filter((h, i) => header.indexOf(h) !== i);
  if (duplicates.length) fail('CSV_DUPLICATE_HEADER', 'Duplicate CSV header: ' + [...new Set(duplicates)].join(', '));
  const rows = [];
  for (let i = 1; i < parsed.rows.length; i++) {
    if (isBlankRow(parsed.rows[i])) continue;
    rows.push(parsed.rows[i]);
  }
  return { header, rows, errors: parsed.errors, meta: { ...parsed.meta, headerLine: headerRow.line } };
}

function columnKind(key) {
  if (CSV_BASE_COLUMNS.includes(key)) return 'base';
  if (key.startsWith(CSV_FIELD_PREFIX)) return 'field';
  if (key.startsWith(CSV_PARAM_PREFIX)) return 'param';
  return null;
}

function normalizeSchema(schema) {
  if (!schema || typeof schema !== 'object' || !Array.isArray(schema.columns) || !schema.columns.length) {
    fail('CSV_SCHEMA', 'Schema with a nonempty columns array is required');
  }
  const byKey = new Map();
  for (const col of schema.columns) {
    if (!col || typeof col.key !== 'string' || !col.key) fail('CSV_SCHEMA', 'Each column needs a nonempty key');
    if (byKey.has(col.key)) fail('CSV_SCHEMA', 'Duplicate schema column: ' + col.key);
    if (!columnKind(col.key)) fail('CSV_SCHEMA', 'Unknown column namespace: ' + col.key);
    const type = col.type ?? 'text';
    if (!['text', 'number', 'bool', 'enum'].includes(type)) fail('CSV_SCHEMA', 'Unsupported column type: ' + type);
    if (type === 'enum' && !Array.isArray(col.options)) fail('CSV_SCHEMA', 'Enum column needs options: ' + col.key);
    byKey.set(col.key, { ...col, type });
  }
  for (const key of CSV_BASE_COLUMNS.slice(0, 2)) {
    if (!byKey.has(key)) fail('CSV_SCHEMA', 'Schema is missing required column: ' + key);
  }
  return { byKey, ordered: schema.columns };
}

/** 模板：数据部分只有表头与样例；说明作为独立对象返回，调用方自行展示或另存。 */
export function buildTemplate(schema) {
  const { byKey, ordered } = normalizeSchema(schema);
  const header = ordered.map((c) => c.key).join(',');
  const sample = ordered.map((c) => {
    const col = byKey.get(c.key);
    const v = own(col, 'sample') ? col.sample : (c.key === 'direction' ? 'encode' : c.key === 'inputKind' ? 'text' : '');
    const s = String(v ?? '');
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }).join(',');
  const instructions = {
    schemaVersion: CSV_SCHEMA_VERSION,
    note: '字段说明只在此处展示，不写入 CSV 数据文件；模板不含任何用户密钥或口令。',
    columns: ordered.map((c) => {
      const col = byKey.get(c.key);
      return {
        key: col.key,
        namespace: columnKind(col.key),
        type: col.type,
        required: col.required === true,
        ...(own(col, 'default') ? { default: col.default } : {}),
        ...(col.options ? { options: col.options.slice() } : {}),
        ...(col.note ? { note: col.note } : {}),
        empty: col.required === true ? 'rejected' : 'kept-empty',
      };
    }),
    rules: [
      '表头存在的空单元格是显式空值，不会被默认值顶替。',
      '只有表头缺失的列才使用声明默认值。',
      '短行、多列、重复表头、未知表头一律报错，不吞行。',
      '数字列必须是有限安全数值；布尔列只接受 true/false/0/1。',
    ],
  };
  return { csv: header + '\r\n' + sample + '\r\n', instructions };
}

const HEX_RE = /^[0-9a-fA-F]*$/;
const B64_RE = /^[A-Za-z0-9+/]*={0,2}$/;

/** 字节通道：hex/base64/utf8 三种显式编码，语法不合法即报错，不做静默截断。 */
function decodeBytes(value, encoding, where) {
  const s = String(value ?? '');
  if (encoding === 'hex') {
    if (s.length % 2 || !HEX_RE.test(s)) fail('CSV_HEX', `${where}: hex input must be an even-length hex string`);
    const out = new Uint8Array(s.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
    return out;
  }
  if (encoding === 'base64') {
    const compact = s.replace(/\s+/g, '');
    if (!B64_RE.test(compact)) fail('CSV_BASE64', `${where}: input is not valid base64`);
    let bin;
    try { bin = atob(compact); } catch { fail('CSV_BASE64', `${where}: input is not valid base64`); }
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  if (encoding === 'utf8') return new TextEncoder().encode(s);
  fail('CSV_ENCODING', `${where}: inputKind=bytes requires encoding=hex|base64|utf8`);
}

function convertCell(col, cell, where) {  const v = cell.value;
  if (col.type === 'text') return v;
  if (v === '') fail('CSV_EMPTY_VALUE', `${where}: ${col.key} requires a value, an empty cell is not a number/bool/enum`);
  if (col.type === 'number') {
    if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(v)) fail('CSV_NUMBER', `${where}: ${col.key} is not a finite decimal number`);
    const n = Number(v);
    if (!Number.isFinite(n)) fail('CSV_NUMBER_RANGE', `${where}: ${col.key} is not finite`);
    // 整数列允许小数会掩盖参数错误；这里只在超出安全整数范围时拒绝，具体整数约束由 op schema 决定。
    if (!Number.isSafeInteger(n) && Math.abs(n) > Number.MAX_SAFE_INTEGER) fail('CSV_NUMBER_RANGE', `${where}: ${col.key} is outside the safe numeric range`);
    return n;
  }
  if (col.type === 'bool') {
    if (!/^(?:true|false|0|1)$/i.test(v)) fail('CSV_BOOL', `${where}: ${col.key} must be true, false, 0 or 1`);
    return /^(?:true|1)$/i.test(v);
  }
  if (!col.options.includes(v)) fail('CSV_ENUM', `${where}: ${col.key} must be one of ${col.options.join('|')}`);
  return v;
}

/**
 * CSV → canonical Task 列表。
 * 返回 { tasks, errors, stats }：结构级错误进 errors，不中断整批；调用方可决定是否执行。
 */
export function tasksFromCsv(text, schema, options = {}) {
  const { byKey } = normalizeSchema(schema);
  const table = parseCsvTable(text);
  // 文件集合：CSV 只写相对路径，字节由调用方（已选文件）注入；不在 CSV 里塞 base64。
  const fileMap = options.files instanceof Map ? options.files : null;
  const errors = table.errors.map((e) => ({ ...e, scope: 'csv' }));
  for (const key of table.header) {
    if (!byKey.has(key)) errors.push({ scope: 'header', code: 'CSV_UNKNOWN_HEADER', message: `Unknown column: ${key}`, column: key });
  }
  const missingRequired = [...byKey.values()]
    .filter((c) => c.required && !table.header.includes(c.key))
    .map((c) => c.key);
  for (const key of missingRequired) errors.push({ scope: 'header', code: 'CSV_MISSING_COLUMN', message: `Missing required column: ${key}`, column: key });
  const stats = { rows: table.rows.length, tasks: 0, blankRows: 0, rejected: 0 };
  const tasks = [];
  if (errors.length) return { tasks, errors, stats, table };

  const allowedOps = Array.isArray(options.ops) ? options.ops : null;

  for (let i = 0; i < table.rows.length; i++) {
    const row = table.rows[i];
    const where = `row ${i + 1} (line ${row.line})`;
    if (row.cells.length !== table.header.length) {
      errors.push({ scope: 'row', line: row.line, code: 'CSV_ROW_WIDTH', message: `${where}: expected ${table.header.length} cells, got ${row.cells.length}` });
      stats.rejected++;
      continue;
    }
    const cells = new Map();
    for (let c = 0; c < table.header.length; c++) cells.set(table.header[c], row.cells[c]);

    const taskId = cells.get('taskId').value;
    const opId = cells.get('opId').value;
    if (!taskId) {
      errors.push({ scope: 'row', line: row.line, code: 'CSV_TASK_ID', message: `${where}: taskId is required` });
      stats.rejected++;
      continue;
    }
    if (!opId) {
      errors.push({ scope: 'row', line: row.line, code: 'CSV_OP_ID', message: `${where}: opId is required` });
      stats.rejected++;
      continue;
    }
    const task = { schemaVersion: TASK_SCHEMA_VERSION, taskId, opId, attempt: 1, fields: {}, params: {} };

    let rowFailed = false;
    for (const [key, cell] of cells) {
      if (key === 'taskId' || key === 'opId') continue;
      const col = byKey.get(key);
      const kind = columnKind(key);
      if (kind === 'base') {
        if (key === 'input') task.input = cell.value;
        else {
          try {
            task[key] = convertCell(col, cell, where);
          } catch (e) {
            errors.push({ scope: 'row', line: row.line, code: e.code, message: e.message });
            rowFailed = true;
          }
        }
        continue;
      }
      const name = key.slice(kind === 'field' ? CSV_FIELD_PREFIX.length : CSV_PARAM_PREFIX.length);
      if (!name) {
        errors.push({ scope: 'row', line: row.line, code: 'CSV_COLUMN_NAME', message: `${where}: empty ${kind} column name` });
        rowFailed = true;
        continue;
      }
      try {
        const value = convertCell(col, cell, where);
        if (kind === 'param') task.params[name] = value;
        else task.fields[name] = value;
      } catch (e) {
        errors.push({ scope: 'row', line: row.line, code: e.code, message: e.message });
        rowFailed = true;
      }
    }
    // 缺列（表头没有）才回落到声明默认值；显式空单元格已在上面按空值处理。
    // 只对 param./field. 生效：direction/inputKind 的权威默认来自 normalizeInput（按 op 能力推断），
    // 用 schema 样例值顶替会让只支持单方向的 op 直接失败。
    for (const col of byKey.values()) {
      if (cells.has(col.key)) continue;
      if (!own(col, 'default')) continue;
      const kind = columnKind(col.key);
      if (kind === 'param') task.params[col.key.slice(CSV_PARAM_PREFIX.length)] = col.default;
      else if (kind === 'field') task.fields[col.key.slice(CSV_FIELD_PREFIX.length)] = col.default;
    }
    if (allowedOps && !allowedOps.includes(opId)) {
      errors.push({ scope: 'row', line: row.line, code: 'CSV_OP_UNSUPPORTED', message: `${where}: operation is outside the verified rollout: ${opId}` });
      stats.rejected++;
      continue;
    }
    // inputKind=file：input 是相对路径，字节必须来自已选文件集合（合同 fileShape）。
    if (task.inputKind === 'file') {
      const path = typeof task.input === 'string' ? task.input : '';
      if (!path) {
        errors.push({ scope: 'row', line: row.line, code: 'CSV_FILE_PATH', message: `${where}: inputKind=file requires a relative path in the input column` });
        stats.rejected++;
        continue;
      }
      const entry = fileMap ? fileMap.get(path) : null;
      if (!entry || !(entry.bytes instanceof Uint8Array)) {
        errors.push({ scope: 'row', line: row.line, code: 'CSV_FILE_MISSING', message: `${where}: file was not selected: ${path}` });
        stats.rejected++;
        continue;
      }
      task.files = [{ path, bytes: entry.bytes, name: entry.name ?? path.split('/').pop(), mime: entry.mime ?? 'application/octet-stream' }];
    }
    if (!Object.keys(task.fields).length) delete task.fields;
    if (!Object.keys(task.params).length) delete task.params;
    if (rowFailed) { stats.rejected++; continue; }
    // 字节通道：inputKind=bytes 时 input 是显式编码文本，这里解成真实字节再交给 Task。
    if (task.inputKind === 'bytes') {
      try {
        const enc = typeof task.encoding === 'string' ? task.encoding : '';
        task.input = decodeBytes(task.input ?? '', enc, where);
      } catch (e) {
        errors.push({ scope: 'row', line: row.line, code: e.code || 'CSV_BYTES', message: e.message });
        stats.rejected++;
        continue;
      }
    }
    if (typeof task.encoding === 'string') delete task.encoding;
    tasks.push(task);
    stats.tasks++;
  }
  return { tasks, errors, stats, table };
}
