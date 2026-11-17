#!/usr/bin/env node
/*
 * CSV 批任务端到端自检（M 侧）：
 * CSV 文本 → tasksFromCsv → 真实 module Worker 队列 → 结果 → CSV/JSON/产物清单。
 * 只覆盖首批 rollout 中可离线验证的 op（base64/md5/diffTool），不声称全表可用。
 */
import { Worker } from 'node:worker_threads';
import { createBatchTaskRunner } from '../src/core/batchTaskRunner.js';
import { tasksFromCsv, buildTemplate } from '../src/core/batchCsv.js';
import { resultsToCsv, resultsToJson, collectArtifacts } from '../src/core/batchTaskExport.js';
import { BATCH_TASK_OPS } from '../src/core/batchTaskContract.js';

const workerUrl = new URL('../src/core/batchTaskWorker.js', import.meta.url).href;
const checks = [];
const ok = (name, cond, detail) => checks.push({ name, status: cond ? 'PASS' : 'FAIL', ...(detail ? { detail } : {}) });

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

const baseSchema = {
  columns: [
    { key: 'taskId', type: 'text', required: true },
    { key: 'opId', type: 'enum', options: BATCH_TASK_OPS.slice(), required: true },
    { key: 'direction', type: 'enum', options: ['run', 'encode', 'decode'] },
    { key: 'inputKind', type: 'enum', options: ['text', 'bytes', 'file', 'none'] },
    { key: 'input', type: 'text' },
  ],
};

// --- 批次 1：两行不同 op，验证逐行独立执行 ---
const csv1 = 'taskId,opId,direction,inputKind,input\r\n' +
  't1,base64,encode,text,hello\r\n' +
  't2,md5,run,text,abc\r\n';
const parsed1 = tasksFromCsv(csv1, baseSchema, { ops: BATCH_TASK_OPS });
ok('CSV 解析出 2 个任务', parsed1.tasks.length === 2 && !parsed1.errors.length, JSON.stringify(parsed1.errors));
ok('任务带 schemaVersion 与 attempt', parsed1.tasks[0].schemaVersion === 1 && parsed1.tasks[0].attempt === 1);

const runner1 = createBatchTaskRunner({ workerFactory: nodeWorkerFactory, concurrency: 1 });
const run1 = await runner1.run(parsed1.tasks, { timeoutMs: 20000 });
await runner1.close?.();
ok('队列返回 2 条结果', run1.results.length === 2);
ok('base64 行结果正确', run1.results[0].status === 'ok' && run1.results[0].text === 'aGVsbG8=', JSON.stringify(run1.results[0]).slice(0, 160));
ok('md5 行结果正确', run1.results[1].status === 'ok' && run1.results[1].text === '900150983cd24fb0d6963f7d28e17f72', run1.results[1].text);

// --- 批次 2：结构化字段行 ---
const fieldSchema = {
  columns: [...baseSchema.columns, { key: 'field.textB', type: 'text' }],
};
const csv2 = 'taskId,opId,direction,inputKind,input,field.textB\r\n' +
  'd1,diffTool,run,text,abc,abd\r\n';
const parsed2 = tasksFromCsv(csv2, fieldSchema, { ops: BATCH_TASK_OPS });
ok('字段列进入 fields', parsed2.tasks.length === 1 && parsed2.tasks[0].fields.textB === 'abd');
const runner2 = createBatchTaskRunner({ workerFactory: nodeWorkerFactory, concurrency: 1 });
const run2 = await runner2.run(parsed2.tasks, { timeoutMs: 20000 });
await runner2.close?.();
ok('diffTool 行执行成功', run2.results[0].status === 'ok' && typeof run2.results[0].text === 'string' && run2.results[0].text.length > 0, JSON.stringify(run2.results[0]).slice(0, 160));

// --- 批次 3：一行坏 op 不阻断后续行（runner 层拒绝整批，此处验证 CSV 层拦截） ---
const csv3 = 'taskId,opId,direction,input\r\n' +
  'x1,notAnOp,run,a\r\n' +
  'x2,base64,encode,b\r\n';
const parsed3 = tasksFromCsv(csv3, baseSchema, { ops: BATCH_TASK_OPS });
ok('rollout 外的 op 在预检被拦下', parsed3.tasks.length === 1 && parsed3.tasks[0].taskId === 'x2', JSON.stringify(parsed3.stats));
ok('预检错误带行号与码', parsed3.errors.some((e) => e.code === 'CSV_OP_UNSUPPORTED' && e.line === 2));

// --- 导出串联 ---
const all = [...run1.results, ...run2.results];
const csvOut = resultsToCsv(all);
ok('结果 CSV 行数 = 结果数 + 表头', csvOut.trim().split('\r\n').length === all.length + 1);
const jsonOut = resultsToJson({ jobId: run1.jobId, results: all });
ok('结果 JSON 汇总正确', jsonOut.total === 3 && jsonOut.ok === 3 && jsonOut.failed === 0);
ok('产物清单为空时也合法', collectArtifacts(all).length === 0);

// --- 模板：数据文件里没有说明注释 ---
const tpl = buildTemplate(baseSchema);
ok('模板 CSV 不含注释', !tpl.csv.split(/\r?\n/).some((l) => l.startsWith('#')));
ok('模板可被自己解析', tasksFromCsv(tpl.csv, baseSchema).stats.rows === 1);

const failed = checks.filter((c) => c.status !== 'PASS');
console.log(JSON.stringify({ verdict: failed.length ? 'FAIL' : 'PASS', checks: checks.length, failed: failed.length, failures: failed, jobIds: [run1.jobId, run2.jobId] }, null, 2));
if (failed.length) process.exitCode = 1;
