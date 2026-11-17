/*
 * batchCsvSection.js — 批处理面板里的「CSV 批量任务」入口。
 *
 * 职责：模板下载 / CSV 载入 / 文件集合绑定 / 预检 / 执行 / 取消 / 结果导出（CSV·JSON·产物 ZIP）。
 * 不做算法、不碰 main.js 全局状态；执行器与导出函数全部由 ctx 注入，便于独立测试。
 *
 *   ctx = {
 *     op,                 // 当前 op；没有就不展开 CSV 模式（CSV 需要 op 的参数表）
 *     buildTemplate,      // src/core/batchCsv.js
 *     tasksFromCsv,
 *     resultsToCsv,       // src/core/batchTaskExport.js
 *     resultsToJson,
 *     collectArtifacts,
 *     artifactsToZipEntries,
 *     runTasks,           // async (tasks, { onProgress, timeoutMs }) => run
 *     cancelRun,          // () => void，取消在途批次
 *     buildZip,           // 可选：src/core/batchRun.js 的 buildZip
 *     download,           // (bytes, name, mime) => void
 *     t,                  // 可选 i18n
 *   }
 *
 * 返回的根节点带 dispose()：面板关闭后，迟到的执行结果不再写回界面。
 */
import { BATCH_TASK_OPS, BATCH_TASK_LIMITS } from '../core/batchTaskContract.js';

const FB = {
  title: 'CSV 批量任务',
  sub: '用一份 CSV 逐行下发不同参数；模板与字段说明分开，说明不会写进数据文件',
  tpl: '下载模板',
  pick: '选择 CSV',
  files: '选择文件',
  dir: '选择目录',
  clearFiles: '清空文件',
  check: '预检',
  run: '执行 CSV',
  cancel: '取消',
  csv: '导出结果 CSV',
  json: '导出结果 JSON',
  zip: '导出产物 ZIP',
  timeout: '单行超时（秒）',
  noOp: 'CSV 模式需要先选定一个算法：请从算法页打开批处理',
  loaded: '已载入 {0}：{1} 行，可执行 {2} 条，错误 {3} 条',
  none: '还没有载入 CSV',
  running: '执行中… {0}/{1}',
  cancelling: '正在取消…',
  done: '完成：成功 {0}，失败 {1}，超时 {2}，取消 {3}，未执行 {4}',
  tplDone: '模板已下载：{0}',
  tplFail: '模板生成失败：{0}',
  readFail: 'CSV 读取失败：{0}',
  utf8: 'CSV 不是合法 UTF-8：{0}',
  runFail: '执行失败：{0}',
  moreErr: '还有 {0} 条未展开',
  noResult: '还没有可导出的结果',
  zipEmpty: '没有产物可以打包',
  hintText: 'inputKind 可填 text（input 即原文）或 none（无输入）',
  hintBytes: 'inputKind 可填 text（input 即原文）、bytes（input 为编码文本，encoding 填 hex / base64 / utf8）、file（先选择文件或目录，input 填文件名或目录内相对路径）或 none',
  filesNone: '尚未选择文件',
  filesInfo: '已选文件 {0} 个，共 {1} 字节',
  filesMore: '… 另有 {0} 个',
  fileTooBig: '{0} 超过单文件上限 {1} 字节，未加入',
  filesTotalBig: '{0} 加入后超过文件总量上限 {1} 字节，未加入',
  fileBadPath: '{0} 的路径不能用作相对路径，未加入',
  fileReplaced: '已替换同路径文件 {0} 个',
  fileReadFail: '{0} 读取失败：{1}',
  timeoutBad: '单行超时须为 1–3600 的整数秒',
  rowFail: '{0}  {1}  {2}',
};

function el(tag, attrs, ...kids) {
  const node = document.createElement(tag);
  if (attrs) {
    for (const k of Object.keys(attrs)) {
      if (k === 'text') node.textContent = attrs[k];
      else if (k === 'class') node.className = attrs[k];
      else if (k === 'style') node.style.cssText = attrs[k];
      else node.setAttribute(k, attrs[k]);
    }
  }
  for (const kid of kids) if (kid) node.append(kid);
  return node;
}

const optionValue = (o) => (typeof o === 'string' ? o : (o && typeof o === 'object' && typeof o.value === 'string' ? o.value : null));

/** 参数定义 → CSV 列定义：只映射冻结类型，不做猜测。样例行必须能原样通过预检。 */
export function schemaForOp(op) {
  const directions = ['run', 'encode', 'decode'].filter((d) => typeof op[d] === 'function');
  // 没有字节适配器的 op 在预检阶段就拒绝 bytes/file，而不是等到执行才逐行失败。
  const kinds = op.acceptsBytes === true ? ['text', 'bytes', 'file', 'none'] : ['text', 'none'];
  const columns = [
    { key: 'taskId', type: 'text', required: true, sample: 'row-1', note: '每行唯一标识' },
    { key: 'opId', type: 'enum', options: [op.id], required: true, default: op.id, sample: op.id },
    { key: 'direction', type: 'enum', options: directions, sample: directions[0] },
    { key: 'inputKind', type: 'enum', options: kinds, default: 'text', sample: 'text' },
    { key: 'input', type: 'text', note: '主输入；inputKind=bytes 时按 encoding 解成字节，file 时填已选文件的相对路径' },
    { key: 'encoding', type: 'text', note: 'inputKind=bytes 时必填：hex / base64 / utf8' },
  ];
  const params = Array.isArray(op.params) ? op.params : [];
  for (const p of params) {
    if (!p || typeof p.key !== 'string') continue;
    const col = { key: 'param.' + p.key, type: 'text', note: p.label || '' };
    if (p.default !== undefined) { col.default = p.default; col.sample = p.default; }
    if (p.type === 'number' || p.type === 'int' || p.type === 'float') col.type = 'number';
    else if (p.type === 'bool' || p.type === 'boolean') col.type = 'bool';
    else if (Array.isArray(p.options) && p.options.length) {
      const values = p.options.map(optionValue);
      if (values.every((v) => v !== null)) { col.type = 'enum'; col.options = values; }
    }
    // 数字/布尔/枚举列的空单元格会被预检拒绝，样例必须给出合法值；无默认值时取首个可用值。
    if (col.sample === undefined || col.sample === '') {
      if (col.type === 'number') col.sample = 0;
      else if (col.type === 'bool') col.sample = false;
      else if (col.type === 'enum') col.sample = col.options[0];
    }
    columns.push(col);
  }
  const fields = Array.isArray(op.fields) ? op.fields : [];
  for (const f of fields) {
    if (!f || typeof f.key !== 'string') continue;
    columns.push({ key: 'field.' + f.key, type: 'text', note: f.label || '结构化输入' });
  }
  return { columns };
}

/** 已选 File → 相对路径键：目录选择去掉所选目录名，单独选文件用文件名。不合法则返回 null。 */
export function relativeKeyForFile(file) {
  const rel = typeof file.webkitRelativePath === 'string' ? file.webkitRelativePath : '';
  let path = rel ? rel.split('/').slice(1).join('/') : file.name;
  if (!path) path = file.name;
  if (typeof path !== 'string' || !path || /[\x00-\x1f\x7f\\:]/.test(path) || path.startsWith('/')) return null;
  if (path.split('/').some((s) => !s || s === '.' || s === '..')) return null;
  return path;
}

export function batchCsvSection(ctx = {}) {
  const c = ctx;
  const t = (key, ...args) => {
    let s = (typeof c.t === 'function' && c.t('ui.batchcsv.' + key)) || FB[key] || key;
    if (s === 'ui.batchcsv.' + key) s = FB[key] || key;
    return String(s).replace(/\{(\d+)\}/g, (m, n) => (args[Number(n)] === undefined ? m : String(args[Number(n)])));
  };
  const op = c.op || null;
  const root = el('section', { class: 'bp-csv' });
  root.dispose = () => {};
  root.isBusy = () => false;
  root.append(el('div', { class: 'bp-csv-title', text: t('title') }), el('div', { class: 'bp-sub', text: t('sub') }));
  if (!op) {
    root.append(el('div', { class: 'bp-sub', text: t('noOp') }));
    return root;
  }

  const schema = schemaForOp(op);
  const acceptsBytes = op.acceptsBytes === true;
  const fileMap = new Map(); // 相对路径 → { bytes, name, mime }
  let fileBytes = 0;
  let csvText = null;
  let csvName = '';
  let parsed = null;
  let run = null;
  let busy = false;
  let disposed = false;
  let epoch = 0;

  const status = el('div', { class: 'bp-sub bp-csv-status', text: t('none') });
  const hint = el('div', { class: 'bp-sub bp-csv-hint', text: t(acceptsBytes ? 'hintBytes' : 'hintText') });
  const fileStatus = el('div', { class: 'bp-sub bp-csv-files', text: t('filesNone') });
  const errBox = el('div', { class: 'bp-csv-errors' });
  const rowBox = el('div', { class: 'bp-csv-errors bp-csv-rows' });
  const csvInput = el('input', { type: 'file', accept: '.csv,text/csv', class: 'bp-csv-input', style: 'display:none' });
  const filesInput = el('input', { type: 'file', multiple: '', class: 'bp-csv-files-input', style: 'display:none' });
  const dirInput = el('input', { type: 'file', multiple: '', webkitdirectory: '', class: 'bp-csv-dir-input', style: 'display:none' });

  const btnTpl = el('button', { type: 'button', text: t('tpl') });
  const btnPick = el('button', { type: 'button', text: t('pick') });
  const btnFiles = el('button', { type: 'button', text: t('files') });
  const btnDir = el('button', { type: 'button', text: t('dir') });
  const btnClearFiles = el('button', { type: 'button', text: t('clearFiles'), disabled: '' });
  const btnCheck = el('button', { type: 'button', text: t('check'), disabled: '' });
  const btnRun = el('button', { type: 'button', class: 'bp-primary', text: t('run'), disabled: '' });
  const btnCancel = el('button', { type: 'button', text: t('cancel'), disabled: '' });
  const btnCsv = el('button', { type: 'button', text: t('csv'), disabled: '' });
  const btnJson = el('button', { type: 'button', text: t('json'), disabled: '' });
  const btnZip = el('button', { type: 'button', text: t('zip'), disabled: '' });
  const timeoutInput = el('input', { type: 'number', min: '1', max: '3600', step: '1', value: '60', class: 'bp-csv-timeout', 'aria-label': t('timeout') });
  const timeoutLabel = el('label', { class: 'bp-sub bp-csv-timeout-label' }, el('span', { text: t('timeout') }), timeoutInput);

  root.append(
    hint,
    el('div', { class: 'bp-row' }, btnTpl, btnPick, btnCheck, btnRun, btnCancel, timeoutLabel),
    acceptsBytes ? el('div', { class: 'bp-row' }, btnFiles, btnDir, btnClearFiles) : null,
    acceptsBytes ? fileStatus : null,
    el('div', { class: 'bp-row' }, btnCsv, btnJson, btnZip),
    status, errBox, rowBox, csvInput, filesInput, dirInput,
  );

  function renderList(box, lines, more) {
    box.textContent = '';
    const max = 10;
    for (let i = 0; i < Math.min(lines.length, max); i++) box.append(el('div', { class: 'bp-err', text: lines[i] }));
    if (lines.length > max) box.append(el('div', { class: 'bp-err', text: t(more, lines.length - max) }));
  }
  function renderErrors(errors) {
    const lines = [];
    for (const e of errors || []) lines.push((e.line ? 'L' + e.line + ' ' : '') + (e.code || '') + ' ' + (e.message || ''));
    renderList(errBox, lines, 'moreErr');
  }
  function renderRunRows() {
    const lines = [];
    if (run) {
      for (const r of run.results) {
        if (r.status === 'ok') continue;
        lines.push(t('rowFail', r.taskId, r.status, (r.error && (r.error.code + ' ' + r.error.message)) || ''));
      }
    }
    renderList(rowBox, lines, 'moreErr');
  }
  function renderFiles() {
    btnClearFiles.disabled = busy || fileMap.size === 0;
    if (!fileMap.size) { fileStatus.textContent = t('filesNone'); return; }
    const names = [...fileMap.keys()];
    const shown = names.slice(0, 6).join('、');
    fileStatus.textContent = t('filesInfo', fileMap.size, fileBytes) + '：' + shown + (names.length > 6 ? ' ' + t('filesMore', names.length - 6) : '');
  }

  function setBusy(v) {
    busy = v;
    btnTpl.disabled = v; btnPick.disabled = v; btnFiles.disabled = v; btnDir.disabled = v;
    btnClearFiles.disabled = v || fileMap.size === 0;
    btnCheck.disabled = v || !parsed;
    btnRun.disabled = v || !parsed || !parsed.tasks.length;
    btnCancel.disabled = !v;
    timeoutInput.disabled = v;
    btnCsv.disabled = v || !run; btnJson.disabled = v || !run; btnZip.disabled = v || !run;
  }

  function summaryText() {
    if (!parsed) return t('none');
    const p = parsed;
    return t('loaded', p.name, p.stats?.rows ?? 0, p.tasks.length, p.errors.length);
  }

  /** 以当前 CSV 文本与文件集合重新解析；文件集合变化后必须重跑，否则 file 行仍是旧判定。 */
  function reparse() {
    if (csvText === null) { parsed = null; status.textContent = t('none'); renderErrors([]); setBusy(busy); return null; }
    let r;
    try {
      r = c.tasksFromCsv(csvText, schema, { ops: BATCH_TASK_OPS, files: fileMap });
    } catch (e) {
      // 表头级错误（空文件 / 重复表头）由解析器直接抛出，这里转成一条可见错误而不是让按钮静默失效。
      r = { tasks: [], errors: [{ scope: 'csv', code: (e && e.code) || 'CSV_ERROR', message: (e && e.message) || String(e) }], stats: { rows: 0 } };
    }
    parsed = { ...r, name: csvName };
    run = null;
    status.textContent = summaryText();
    renderErrors(r.errors);
    renderRunRows();
    setBusy(busy);
    return r;
  }

  async function addFiles(list) {
    const notes = [];
    let replaced = 0;
    for (const file of list) {
      const path = relativeKeyForFile(file);
      if (!path) { notes.push(t('fileBadPath', file.name)); continue; }
      if (file.size > BATCH_TASK_LIMITS.maxFileBytes) { notes.push(t('fileTooBig', path, BATCH_TASK_LIMITS.maxFileBytes)); continue; }
      const previous = fileMap.get(path);
      const nextTotal = fileBytes - (previous ? previous.bytes.byteLength : 0) + file.size;
      if (nextTotal > BATCH_TASK_LIMITS.maxTotalInputBytes) { notes.push(t('filesTotalBig', path, BATCH_TASK_LIMITS.maxTotalInputBytes)); continue; }
      let bytes;
      try {
        bytes = new Uint8Array(await file.arrayBuffer());
      } catch (e) {
        notes.push(t('fileReadFail', path, (e && e.message) || String(e)));
        continue;
      }
      if (disposed) return;
      if (previous) replaced++;
      fileMap.set(path, { bytes, name: file.name, mime: file.type || 'application/octet-stream' });
      fileBytes = nextTotal;
    }
    if (replaced) notes.push(t('fileReplaced', replaced));
    renderFiles();
    reparse();
    if (notes.length) renderList(errBox, notes.concat([...errBox.children].map((n) => n.textContent)), 'moreErr');
  }

  btnTpl.addEventListener('click', () => {
    try {
      const tpl = c.buildTemplate(schema);
      c.download(new TextEncoder().encode(tpl.csv), op.id + '-batch-template.csv', 'text/csv');
      status.textContent = t('tplDone', tpl.csv.split(/\r?\n/)[0]);
      renderErrors([]);
    } catch (e) {
      status.textContent = t('tplFail', (e && e.message) || String(e));
    }
  });

  btnPick.addEventListener('click', () => csvInput.click());
  csvInput.addEventListener('change', async () => {
    const file = csvInput.files && csvInput.files[0];
    csvInput.value = '';
    if (!file) return;
    try {
      const buf = new Uint8Array(await file.arrayBuffer());
      if (disposed) return;
      let text;
      try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(buf);
      } catch (e) {
        status.textContent = t('utf8', (e && e.message) || String(e));
        return;
      }
      csvText = text;
      csvName = file.name;
      reparse();
    } catch (e) {
      status.textContent = t('readFail', (e && e.message) || String(e));
    }
  });

  btnFiles.addEventListener('click', () => filesInput.click());
  btnDir.addEventListener('click', () => dirInput.click());
  for (const input of [filesInput, dirInput]) {
    input.addEventListener('change', async () => {
      const list = input.files ? [...input.files] : [];
      input.value = '';
      if (list.length) await addFiles(list);
    });
  }
  btnClearFiles.addEventListener('click', () => {
    fileMap.clear();
    fileBytes = 0;
    renderFiles();
    reparse();
  });

  btnCheck.addEventListener('click', () => { reparse(); });

  btnRun.addEventListener('click', async () => {
    if (!parsed || !parsed.tasks.length || busy) return;
    const seconds = Number(timeoutInput.value);
    if (!Number.isInteger(seconds) || seconds < 1 || seconds > 3600) { status.textContent = t('timeoutBad'); return; }
    const mine = ++epoch;
    setBusy(true);
    run = null;
    renderRunRows();
    const total = parsed.tasks.length;
    let done = 0;
    status.textContent = t('running', 0, total);
    try {
      const res = await c.runTasks(parsed.tasks, {
        timeoutMs: seconds * 1000,
        onProgress: () => { done++; if (!disposed && mine === epoch) status.textContent = t('running', done, total); },
      });
      // 面板已关闭或已开始新一轮：这份结果没有归属，丢弃而不是写回界面。
      if (disposed || mine !== epoch) return;
      run = res;
      const s = res.stats || {};
      status.textContent = t('done', s.ok ?? 0, s.error ?? 0, s.timeout ?? 0, s.cancelled ?? 0, s.skipped ?? 0);
      renderRunRows();
    } catch (e) {
      if (disposed || mine !== epoch) return;
      status.textContent = t('runFail', (e && e.message) || String(e));
    } finally {
      if (!disposed && mine === epoch) setBusy(false);
    }
  });

  btnCancel.addEventListener('click', () => {
    if (!busy) return;
    status.textContent = t('cancelling');
    if (typeof c.cancelRun === 'function') c.cancelRun();
  });

  btnCsv.addEventListener('click', () => {
    if (!run) { status.textContent = t('noResult'); return; }
    const csv = c.resultsToCsv(run.results, { bom: true });
    c.download(new TextEncoder().encode(csv), op.id + '-batch-results.csv', 'text/csv');
  });

  btnJson.addEventListener('click', () => {
    if (!run) { status.textContent = t('noResult'); return; }
    const json = JSON.stringify(c.resultsToJson(run), null, 2);
    c.download(new TextEncoder().encode(json), op.id + '-batch-results.json', 'application/json');
  });

  btnZip.addEventListener('click', () => {
    if (!run) { status.textContent = t('noResult'); return; }
    const arts = c.collectArtifacts(run.results);
    if (!arts.length || typeof c.buildZip !== 'function') { status.textContent = t('zipEmpty'); return; }
    const bytes = c.buildZip(c.artifactsToZipEntries(arts));
    c.download(bytes, op.id + '-batch-artifacts.zip', 'application/zip');
  });

  root.dispose = () => { disposed = true; epoch++; fileMap.clear(); fileBytes = 0; };
  root.isBusy = () => busy;
  setBusy(false);
  return root;
}
