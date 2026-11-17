#!/usr/bin/env node
/*
 * CSV 批任务「与单次真实执行等价」对拍。
 *
 * 判据：同一组参数，批任务通道的结果必须与直接调用 op 的单次结果逐字节一致；
 *       期望值来自 RFC/NIST 公开向量并硬编码在本文件，不从任何结果文件回填。
 * 覆盖：base64（含错误分支）、md5、aes-CBC、aes-GCM、rsaCrt（多字段）、gifFrames（文件+多产物）。
 * 边界：只代表这 6 个 op；其余 op 不在本对拍内，不得据此声称已支持。
 */
import { Worker } from 'node:worker_threads';
import { createBatchTaskRunner } from '../src/core/batchTaskRunner.js';
import { tasksFromCsv } from '../src/core/batchCsv.js';
import { BATCH_TASK_OPS } from '../src/core/batchTaskContract.js';

await import('../src/core/registerAll.js');
const { getOp } = await import('../src/core/registry.js');

const workerUrl = new URL('../src/core/batchTaskWorker.js', import.meta.url).href;
const checks = [];
const ok = (name, cond, detail) => checks.push({ name, status: cond ? 'PASS' : 'FAIL', ...(detail ? { detail: String(detail).slice(0, 300) } : {}) });
const rows = [];

function nodeWorkerFactory() {
  const listeners = new Map();
  const source = `import {parentPort} from 'node:worker_threads';
    let ready=false; const pending=[];
    globalThis.self={postMessage:(data,transfer)=>parentPort.postMessage(data,transfer),onmessage:null};
    parentPort.on('message',data=>ready?dispatch(data):pending.push(data));
    await import(${JSON.stringify(workerUrl)});
    const handler=self.onmessage;
    function dispatch(data){handler({data});}
    ready=true; for(const data of pending)dispatch(data);`;
  const worker = new Worker(new URL('data:text/javascript,' + encodeURIComponent(source)), { execArgv: ['--no-warnings'] });
  worker.on('message', () => {});
  return {
    postMessage(value) { worker.postMessage(value); },
    terminate() { return worker.terminate(); },
    addEventListener(type, fn) {
      const wrapped = type === 'message' ? (data) => fn({ data }) : (error) => fn({ message: error.message, preventDefault() {} });
      listeners.set(fn, wrapped); worker.on(type, wrapped);
    },
    removeEventListener(type, fn) { const wrapped = listeners.get(fn); if (wrapped) worker.off(type, wrapped); listeners.delete(fn); },
  };
}

const csvCell = (v) => {
  const s = String(v ?? '');
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
const hex = (s) => Uint8Array.from(s.match(/../g).map((x) => parseInt(x, 16)));
// 最小合法 GIF89a：1×1、单帧。
const gifBytes = hex('47494638396101000100800000000000ffffff21f90401000000002c00000000010001000002024401003b');

// 公开向量：RFC 4648 §10 / RFC 1321 A.5 / NIST SP 800-38A F.2.1 / NIST GCM TC2
const AES_KEY = '2b7e151628aed2a6abf7158809cf4f3c';
const AES_IV = '000102030405060708090a0b0c0d0e0f';
const AES_PT = '6bc1bee22e409f96e93d7e117393172a';
const AES_CT = '7649abac8119b246cee98e9b12e9197d';
const GCM_IV = '000000000000000000000000';
const GCM_EXPECT = '000000000000000000000000' + '0388dace60b6a392f328c2b971b2fe78' + 'ab6e47d42cec13bdf53a67b21257bddf';

const CASES = [
  { id: 'b64-enc', opId: 'base64', fn: 'encode', input: 'hello', inputKind: 'text', expect: 'aGVsbG8=' },
  { id: 'b64-dec', opId: 'base64', fn: 'decode', input: 'aGVsbG8=', inputKind: 'text', expect: 'hello' },
  { id: 'b64-strict-bad', opId: 'base64', fn: 'decode', input: 'aGVsbG8*', inputKind: 'text', params: { strictMode: 'true' }, expectError: true },
  { id: 'md5-abc', opId: 'md5', fn: 'run', input: 'abc', inputKind: 'text', expect: '900150983cd24fb0d6963f7d28e17f72' },
  {
    id: 'aes-cbc-nist', opId: 'aes', fn: 'encode', inputKind: 'bytes', encoding: 'hex', inputHex: AES_PT,
    params: { key: AES_KEY, keyEnc: 'hex', mode: 'CBC', iv: AES_IV, ivEnc: 'hex', padding: 'none', outEnc: 'hex' }, expect: AES_CT,
  },
  {
    id: 'aes-gcm-nist', opId: 'aes', fn: 'encode', inputKind: 'bytes', encoding: 'hex', inputHex: '00000000000000000000000000000000',
    params: { key: '00000000000000000000000000000000', keyEnc: 'hex', mode: 'GCM', iv: GCM_IV, ivEnc: 'hex', includeIv: 'prepend', tagLen: '128', outEnc: 'hex' }, expect: GCM_EXPECT,
  },
  { id: 'rsacrt-23', opId: 'rsaCrt', fn: 'run', input: '', singleInput: '2,3,2\n3,5,7', inputKind: 'text', fields: { residues: '2,3,2', moduli: '3,5,7' }, expectContains: 'x = 23' },
  { id: 'gif-frames', opId: 'gifFrames', fn: 'run', input: 'tiny.gif', inputKind: 'file', files: new Map([['tiny.gif', { bytes: gifBytes, name: 'tiny.gif', mime: 'image/gif' }]]), expectFiles: ['gif_frames.zip', 'frame_001.png'] },
];

function normSingle(out) {
  if (typeof out === 'string') return { text: out, files: [] };
  if (out instanceof Uint8Array || out instanceof ArrayBuffer) {
    const b = out instanceof Uint8Array ? out : new Uint8Array(out);
    return { text: '', files: [{ name: 'result.bin', bytes: b }] };
  }
  if (out && typeof out === 'object') {
    return { text: typeof out.text === 'string' ? out.text : '', files: Array.isArray(out.files) ? out.files.map((f) => ({ name: f && f.name, bytes: f && f.bytes })) : [] };
  }
  return { text: String(out ?? ''), files: [] };
}
const sameBytes = (a, b) => {
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
};

async function runBatchOnce(c) {
  const base = [
    { key: 'taskId', type: 'text', required: true },
    { key: 'opId', type: 'enum', options: [c.opId], required: true },
    { key: 'direction', type: 'enum', options: [c.fn] },
    { key: 'inputKind', type: 'enum', options: ['text', 'bytes', 'file', 'none'] },
    { key: 'input', type: 'text' },
    { key: 'encoding', type: 'text' },
  ];
  const params = c.params || {};
  const paramCols = Object.entries(params).map(([k]) => ({ key: 'param.' + k, type: 'text' }));
  const fieldCols = Object.keys(c.fields || {}).map((k) => ({ key: 'field.' + k, type: 'text' }));
  const schema = { columns: [...base, ...paramCols, ...fieldCols] };
  const cells = [];
  for (const col of schema.columns) {
    if (col.key === 'taskId') cells.push('p1');
    else if (col.key === 'opId') cells.push(c.opId);
    else if (col.key === 'direction') cells.push(c.fn);
    else if (col.key === 'inputKind') cells.push(c.inputKind);
    else if (col.key === 'input') cells.push(c.inputHex ?? c.input);
    else if (col.key === 'encoding') cells.push(c.encoding ?? '');
    else if (col.key.startsWith('param.')) cells.push(params[col.key.slice(6)] ?? '');
    else if (col.key.startsWith('field.')) cells.push((c.fields || {})[col.key.slice(6)] ?? '');
  }
  const csv = schema.columns.map((x) => x.key).join(',') + '\r\n' + cells.map(csvCell).join(',') + '\r\n';
  const parsed = tasksFromCsv(csv, schema, { ops: BATCH_TASK_OPS, files: c.files });
  if (parsed.errors.length) return { parseErrors: parsed.errors, csv };
  const runner = createBatchTaskRunner({ workerFactory: nodeWorkerFactory, concurrency: 1 });
  const run = await runner.run(parsed.tasks, { timeoutMs: 30000 });
  runner.dispose?.();
  return { result: run.results[0], csv };
}

for (const c of CASES) {
  const label = `${c.id} (${c.opId}.${c.fn})`;
  const op = getOp(c.opId);
  const singleParams = { ...(c.params || {}) };
  if (c.inputKind === 'bytes') singleParams.rawBytes = hex(c.inputHex);
  if (c.inputKind === 'file') singleParams.rawBytes = c.files.get('tiny.gif').bytes;
  const singleInput = c.inputKind === 'bytes' || c.inputKind === 'file' ? '' : (c.singleInput ?? c.input ?? '');
  let singleOut = null, singleErr = null;
  try { singleOut = await op[c.fn](singleInput, singleParams); } catch (e) { singleErr = e; }

  const batch = await runBatchOnce(c);
  if (batch.parseErrors) { ok(label + ' · CSV 解析', false, JSON.stringify(batch.parseErrors)); continue; }
  const r = batch.result;
  rows.push({ id: c.id, status: r.status, textLen: (r.text || '').length, files: (r.files || []).map((f) => f.name + ':' + f.size) });

  ok(label + ' · 批次状态与单次一致', (!!singleErr) === (r.status !== 'ok'), `singleErr=${singleErr && singleErr.message} status=${r.status} err=${r.error && r.error.message}`);
  if (c.expectError) {
    ok(label + ' · 按预期失败', r.status === 'error');
    continue;
  }
  ok(label + ' · 批次必须成功', r.status === 'ok', r.error && r.error.message);
  const s = normSingle(singleOut);
  ok(label + ' · 文本与单次逐字一致', r.text === s.text, `batch=${JSON.stringify(r.text).slice(0, 100)} single=${JSON.stringify(s.text).slice(0, 100)}`);
  const bf = (r.files || []).map((f) => ({ name: f.name, bytes: f.bytes }));
  const sizeOk = bf.length === s.files.length;
  let same = sizeOk;
  if (sizeOk) for (let i = 0; i < bf.length; i++) if (bf[i].name !== s.files[i].name || !sameBytes(bf[i].bytes, s.files[i].bytes)) same = false;
  ok(label + ' · 产物完整且与单次一致', same, `batch=${bf.map((f) => f.name + ':' + (f.bytes ? f.bytes.length : 0)).join(',')} single=${s.files.map((f) => f.name + ':' + (f.bytes ? f.bytes.length : 0)).join(',')}`);
  if (c.expect !== undefined) ok(label + ' · 符合公开向量', s.text === c.expect, `got=${JSON.stringify(s.text).slice(0, 100)}`);
  if (c.expectContains !== undefined) ok(label + ' · 符合公开向量', s.text.includes(c.expectContains), `got=${JSON.stringify(s.text).slice(0, 120)}`);
  if (c.expectFiles) {
    const names = s.files.map((f) => f.name);
    ok(label + ' · 产物名符合预期', c.expectFiles.every((n) => names.includes(n)), JSON.stringify(names));
  }
}

// 负控：路径没选文件必须显式报错
const gifSchema = { columns: [
  { key: 'taskId', type: 'text', required: true },
  { key: 'opId', type: 'enum', options: ['gifFrames'], required: true },
  { key: 'direction', type: 'enum', options: ['run'] },
  { key: 'inputKind', type: 'enum', options: ['file'] },
  { key: 'input', type: 'text' },
] };
const missing = tasksFromCsv('taskId,opId,direction,inputKind,input\r\ng1,gifFrames,run,file,not-selected.gif\r\n', gifSchema);
ok('未选文件的 file 行显式报错', missing.errors.some((e) => e.code === 'CSV_FILE_MISSING') && missing.tasks.length === 0, JSON.stringify(missing.errors));

// 负控：bytes 行缺 encoding 必须显式报错
const bSchema = { columns: [
  { key: 'taskId', type: 'text', required: true },
  { key: 'opId', type: 'enum', options: ['aes'], required: true },
  { key: 'inputKind', type: 'enum', options: ['bytes'] },
  { key: 'input', type: 'text' },
  { key: 'encoding', type: 'text' },
] };
const noEnc = tasksFromCsv('taskId,opId,inputKind,input,encoding\r\nb1,aes,bytes,0011,\r\n', bSchema);
ok('bytes 行缺 encoding 显式报错', noEnc.errors.some((e) => e.code === 'CSV_ENCODING') && noEnc.tasks.length === 0, JSON.stringify(noEnc.errors));

console.error(JSON.stringify(rows, null, 1));
const failed = checks.filter((c) => c.status !== 'PASS');
console.log(JSON.stringify({ verdict: failed.length ? 'FAIL' : 'PASS', checks: checks.length, failed: failed.length, failures: failed }, null, 2));
if (failed.length) process.exitCode = 1;
