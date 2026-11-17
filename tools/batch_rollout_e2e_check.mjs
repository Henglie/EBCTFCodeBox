#!/usr/bin/env node
/**
 * 放行名单端到端检查：用例走「CSV 预检（现用放行名单）→ 独立 Worker 执行」，结果必须等于 expect.text。
 * 与 batch_rollout_probe 的区别：这里不传 rollout 覆盖口，验证的是现用名单真的放行且在 Worker 里跑得通。
 * 用法：node tools/batch_rollout_e2e_check.mjs <cases.json> [更多 cases.json] [--out report.json]
 */
import { Worker } from 'node:worker_threads';
import { readFileSync, writeFileSync } from 'node:fs';
import { createBatchTaskRunner } from '../src/core/batchTaskRunner.js';
import { tasksFromCsv } from '../src/core/batchCsv.js';
import { BATCH_TASK_OPS } from '../src/core/batchTaskContract.js';

const args = process.argv.slice(2);
const outAt = args.indexOf('--out');
const outPath = outAt >= 0 ? args.splice(outAt, 2)[1] : null;
if (!args.length) { console.error('usage: node tools/batch_rollout_e2e_check.mjs <cases.json>... [--out report.json]'); process.exit(2); }

await import('../src/core/registerAll.js');
const { getOp } = await import('../src/core/registry.js');
const { OP_FILE_MAP } = await import('../src/core/lazyTables.generated.js');
const { schemaForOp } = await import('../src/ui/batchCsvSection.js');

const workerUrl = new URL('../src/core/batchTaskWorker.js', import.meta.url).href;
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
async function loadOp(id) {
  let op = getOp(id);
  if ((!op || op.__stub) && OP_FILE_MAP[id]) { await import(new URL(OP_FILE_MAP[id], new URL('../src/core/', import.meta.url)).href); op = getOp(id); }
  return op && !op.__stub ? op : null;
}
const cell = (v) => { const s = String(v ?? ''); return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };

const cases = args.flatMap((p) => JSON.parse(readFileSync(p, 'utf8')).cases || []);
const failures = [];
const tasks = [];
const expectById = new Map();
for (const c of cases) {
  if (!c.expect || typeof c.expect.text !== 'string') continue; // 只核文本期望；产物类由探针负责
  const op = await loadOp(c.opId);
  if (!op) { failures.push({ id: c.id, problem: '算法未注册' }); continue; }
  const params = c.params || {}, fields = c.fields || {};
  const header = ['taskId', 'opId', 'direction', 'inputKind', 'input', 'encoding', ...Object.keys(params).map((k) => 'param.' + k), ...Object.keys(fields).map((k) => 'field.' + k)];
  const row = [c.id, c.opId, c.direction ?? '', c.inputKind ?? 'text', c.input ?? '', c.encoding ?? '', ...Object.values(params), ...Object.values(fields)];
  const parsed = tasksFromCsv(header.join(',') + '\r\n' + row.map(cell).join(',') + '\r\n', schemaForOp(op), { ops: BATCH_TASK_OPS });
  if (parsed.errors.length || parsed.tasks.length !== 1) { failures.push({ id: c.id, problem: '预检未通过：' + parsed.errors.map((e) => e.code + ' ' + e.message).join('; ') }); continue; }
  tasks.push(parsed.tasks[0]);
  expectById.set(c.id, c.expect.text);
}
let passed = 0;
for (let i = 0; i < tasks.length; i += 100) { // 单批不超过合同的 maxTasks
  const runner = createBatchTaskRunner({ workerFactory: nodeWorkerFactory, concurrency: 2 });
  const run = await runner.run(tasks.slice(i, i + 100), { timeoutMs: 30000 });
  await runner.close?.(); runner.dispose?.();
  for (const r of run.results) {
    if (r.status !== 'ok') failures.push({ id: r.taskId, problem: 'Worker 结果 ' + r.status + ' ' + (r.error ? r.error.code + ' ' + r.error.message : '') });
    else if (r.text !== expectById.get(r.taskId)) failures.push({ id: r.taskId, problem: '文本不等于 expect.text', got: r.text.slice(0, 120) });
    else passed++;
  }
}
const ops = [...new Set(cases.map((c) => c.opId))];
const report = { verdict: failures.length === 0 && passed > 0 ? 'PASS' : 'FAIL', rolloutSize: BATCH_TASK_OPS.length, cases: cases.length, executed: tasks.length, passed, ops: ops.length,
  opsOutsideRollout: ops.filter((id) => !BATCH_TASK_OPS.includes(id)), failures };
if (outPath) writeFileSync(outPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
process.exit(report.verdict === 'PASS' ? 0 : 1);
