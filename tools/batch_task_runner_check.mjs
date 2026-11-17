import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { createHash } from 'node:crypto';
import { createBatchTaskRunner } from '../src/core/batchTaskRunner.js';
import { executeBatchTask } from '../src/core/batchTaskExecution.js';
const workerUrl = new URL('../src/core/batchTaskWorker.js', import.meta.url).href;
const checks = [], timings = [], terminations = [];
const check = (name, fn) => { fn(); checks.push(name); };
const rejects = async (name, code, fn) => { await assert.rejects(fn, e => e.code === code); checks.push(name); };
function factory(options = {}) {
  let count = 0, started = 0;
  const make = () => {
    const first = count++ === 0;
    // Run the actual module worker in Node; only the standard host message API
    // is adapted. A bounded CPU fixture separately exercises hard termination.
    const source = `import {parentPort} from 'node:worker_threads';
      let ready=false; const pending=[];
      globalThis.self={postMessage:(data,transfer)=>{
        if (${!!options.corruptOnce && first} && data.type==='result') data={...data,result:{...data.result,text:42}};
        parentPort.postMessage(data,transfer);
      },onmessage:null};
      parentPort.on('message',data=>ready?dispatch(data):pending.push(data));
      ${options.dieOnce && first ? "throw new Error('Synthetic worker startup failure');" : ''}
      await import(${JSON.stringify(workerUrl)});
      const handler=self.onmessage;
      function dispatch(data){
        if (${!!options.spurious}) parentPort.postMessage({type:'result',jobId:'obsolete-job',taskId:data.task.taskId,attempt:99,result:{text:'STALE'}});
        if (${!!options.slow} && data.task.taskId==='slow') {
          parentPort.postMessage({type:'fixture-started'});
          const stop=performance.now()+1500; while(performance.now()<stop){};
        }
        handler({data});
      }
      ready=true; for(const data of pending)dispatch(data);`;
    const worker = new Worker(new URL('data:text/javascript,' + encodeURIComponent(source)), { execArgv: ['--no-warnings'] });
    const listeners = new Map();
    worker.on('message', data => { if (data.type === 'fixture-started') started++; });
    const stopped = new Promise(done => worker.once('exit', done));
    terminations.push(stopped);
    return {
      postMessage(value) { worker.postMessage(value); },
      terminate() { return worker.terminate(); },
      addEventListener(type, fn) {
        const wrapped = type === 'message' ? data => fn({ data }) : error => fn({ message: error.message, preventDefault() {} });
        listeners.set(fn, wrapped); worker.on(type, wrapped);
      },
      removeEventListener(type, fn) { const wrapped = listeners.get(fn); if (wrapped) worker.off(type, wrapped); listeners.delete(fn); },
    };
  };
  make.count = () => count; make.started = () => started;
  return make;
}
const textTask = (taskId, input = 'A') => ({ taskId, opId: 'base64', direction: 'encode', input });
const gif = new Uint8Array([
  ...new TextEncoder().encode('GIF89a'), 1, 0, 1, 0, 0x80, 0, 0, 0, 0, 0, 255, 255, 255,
  0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 2, 0x44, 1, 0,
  0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 2, 0x4c, 1, 0, 0x3b,
]);
const requests = [
  { ...textTask('text', 'foo') },
  { taskId: 'digest', opId: 'md5', input: 'abc' },
  { taskId: 'cipher', opId: 'aes', direction: 'encode', inputKind: 'bytes', input: Buffer.from('6bc1bee22e409f96e93d7e117393172a', 'hex'), params: { key: '2b7e151628aed2a6abf7158809cf4f3c', keyEnc: 'hex', iv: '000102030405060708090a0b0c0d0e0f', mode: 'CBC', padding: 'none', outEnc: 'hex' } },
  { taskId: 'none', opId: 'rsaModpow', inputKind: 'none', params: { base: '2', exp: '10', mod: '17' } },
  { taskId: 'fields', opId: 'rsaCrt', fields: { residues: '2,3,2', moduli: '3,5,7' } },
  { taskId: 'matrix', opId: 'babaiCvp', fields: { basis: '1 0\n0 1', target: '2 3' } },
  { taskId: 'diff', opId: 'diffTool', input: 'abc', fields: { textB: 'abd' }, params: { inputEnc: 'utf8' } },
  { taskId: 'files', opId: 'gifFrames', inputKind: 'bytes', input: gif },
];
for (const options of [{ concurrency: 0 }, { concurrency: 5 }, { timeoutMs: NaN }, { timeoutMs: Infinity }, { timeoutMs: -1 }, { limits: { maxTasks: -1 } }]) check('invalid options fail closed', () => assert.throws(() => createBatchTaskRunner(options)));
const realFactory = factory(), real = createBatchTaskRunner({ workerFactory: realFactory, concurrency: 2 });
const result = await real.run(requests);
check('eight real module-worker operations succeed in input order', () => { assert.equal(result.stats.ok, 8); assert.deepEqual(result.results.map(r => r.taskId), requests.map(r => r.taskId)); });
check('RFC4648 and RFC1321 independent vectors survive worker transport', () => { assert.equal(result.results[0].text, 'Zm9v'); assert.equal(result.results[1].text, '900150983cd24fb0d6963f7d28e17f72'); });
check('NIST SP800-38A key/IV vector survives worker transport', () => assert.equal(result.results[2].text, '7649abac8119b246cee98e9b12e9197d'));
check('GIF ZIP plus both PNG files survive transport', () => {
  const files = result.results[7].files; assert.equal(files.length, 3);
  const zip = files.find(f => f.name.endsWith('.zip')); assert(zip); assert.deepEqual([...zip.bytes.slice(0, 4)], [80, 75, 3, 4]);
  const frames = files.filter(f => f.name.endsWith('.png')); assert.equal(frames.length, 2);
  for (const file of frames) { assert.deepEqual([...file.bytes.slice(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]); assert.equal(new DataView(file.bytes.buffer, file.bytes.byteOffset).getUint32(16), 1); }
});
check('caller byte buffers were cloned, not detached', () => { assert.equal(gif[0], 71); assert.equal(requests[2].input.length, 16); });
check('parallel lanes are batch-owned and all stop at completion', () => { assert.equal(realFactory.count(), 2); assert.equal(real.busy, false); assert.equal(real.cancel(), false); });
for (let i = 0; i < requests.length; i++) {
  const direct = await executeBatchTask(requests[i]);
  check('single invocation equals batch result ' + requests[i].taskId, () => { assert.equal(direct.text, result.results[i].text); assert.deepEqual(direct.files, result.results[i].files); });
}
const failures = await real.run([{ taskId: 'bad-key', opId: 'aes', direction: 'encode', input: 'A', params: { key: 'bad' } }, { taskId: 'unsupported', opId: 'jphswinLaunch', input: '' }, textTask('after-failure')]);
check('row errors and unsupported operations do not stop later rows', () => assert.deepEqual(failures.results.map(r => r.status), ['error', 'error', 'ok']));
const callback = await real.run([textTask('callback')], { onProgress() { throw new Error('observer failed'); } });
check('observer failure is recorded without corrupting results', () => { assert.equal(callback.stats.ok, 1); assert.equal(callback.warnings.length, 1); });
await rejects('duplicate task identities rejected', 'TASK_DUPLICATE_ID', () => real.run([textTask('dup'), textTask('dup')]));
await rejects('nonpositive timeout rejected', 'TASK_OPTIONS', () => real.run([textTask('a')], { timeoutMs: 0 }));
const attempts = await real.run([{ ...textTask('invalid-attempt'), attempt: 0 }, textTask('valid-after-attempt')]);
check('invalid attempt is a row failure', () => { assert.equal(attempts.results[0].error.code, 'TASK_ATTEMPT'); assert.equal(attempts.results[1].status, 'ok'); });
const clone = await real.run([{ ...textTask('cannot-clone'), params: { f() {} } }, textTask('clone-next')]);
check('noncloneable input fails one row explicitly', () => { assert.equal(clone.results[0].error.code, 'TASK_CLONE'); assert.equal(clone.results[1].status, 'ok'); });
const snapshotRows = [textTask('first'), textTask('second', 'B')], snapshotPromise = real.run(snapshotRows);
snapshotRows[1].input = 'CHANGED'; snapshotRows[1].taskId = 'first';
const snapshot = await snapshotPromise;
check('queued rows keep their initial identity and payload', () => { assert.equal(snapshot.results[1].taskId, 'second'); assert.equal(snapshot.results[1].text, 'Qg=='); });
const abortedFactory = factory(), aborted = createBatchTaskRunner({ workerFactory: abortedFactory });
const controller = new AbortController(); controller.abort();
const preAborted = await aborted.run([textTask('a'), textTask('b')], { signal: controller.signal });
check('pre-aborted batches dispatch no worker', () => { assert.equal(abortedFactory.count(), 0); assert.deepEqual(preAborted.results.map(r => r.status), ['skipped', 'skipped']); });
const slowFactory = factory({ slow: true }), slow = createBatchTaskRunner({ workerFactory: slowFactory, timeoutMs: 5000 });
const startedAt = performance.now(), running = slow.run([textTask('slow'), textTask('never-started')]);
for (let i = 0; i < 100 && !slowFactory.started(); i++) await new Promise(done => setTimeout(done, 10));
assert(slowFactory.started(), 'Bounded CPU fixture really started');
const independent = await real.run([textTask('independent', 'B')]);
slow.cancel('user stopped this batch');
const cancelled = await running;
timings.push({ name: 'cancel-with-bounded-worker-fixture', elapsedMs: performance.now() - startedAt });
check('cancel terminates current CPU task and explicitly skips queued rows', () => assert.deepEqual(cancelled.results.map(r => r.status), ['cancelled', 'skipped']));
check('another runner is unaffected by cancellation', () => assert.equal(independent.results[0].text, 'Qg=='));
const disposeFactory = factory({ slow: true }), disposing = createBatchTaskRunner({ workerFactory: disposeFactory });
const disposePromise = disposing.run([textTask('slow'), textTask('closed-queue')]);
await rejects('one runner cannot attach a second active batch', 'TASK_BATCH_BUSY', () => disposing.run([textTask('overlap')]));
for (let i = 0; i < 100 && !disposeFactory.started(); i++) await new Promise(done => setTimeout(done, 10));
assert(disposeFactory.started()); disposing.dispose();
const disposedRun = await disposePromise;
check('disposing an active batch terminates it and settles every row', () => { assert.deepEqual(disposedRun.results.map(r => r.status), ['cancelled', 'skipped']); assert.equal(disposing.busy, false); });
const reused = await slow.run([textTask('retry', 'C')]);
check('a new run has a new identity and clean worker', () => { assert.notEqual(reused.jobId, cancelled.jobId); assert.equal(reused.results[0].text, 'Qw=='); });
const timeoutFactory = factory({ slow: true }), timed = createBatchTaskRunner({ workerFactory: timeoutFactory, timeoutMs: 1000 });
const timeoutStart = performance.now(), timeout = await timed.run([textTask('slow'), textTask('after-timeout')]);
timings.push({ name: 'hard-timeout-and-next-task', elapsedMs: performance.now() - timeoutStart });
check('timeout terminates CPU worker, recreates and continues', () => { assert(timeoutFactory.started()); assert.deepEqual(timeout.results.map(r => r.status), ['timeout', 'ok']); assert.equal(timeoutFactory.count(), 2); });
const stale = createBatchTaskRunner({ workerFactory: factory({ spurious: true }) });
const staleResult = await stale.run([{ ...textTask('attempt'), attempt: 2 }]);
check('wrong job/attempt messages never attach', () => { assert.equal(staleResult.results[0].text, 'QQ=='); assert.equal(staleResult.results[0].attempt, 2); });
for (const config of [{ corruptOnce: true }, { dieOnce: true }]) {
  const brokenFactory = factory(config), broken = createBatchTaskRunner({ workerFactory: brokenFactory });
  const brokenResult = await broken.run([textTask('bad-host'), textTask('good-host')]);
  check('malformed or crashed worker fails one row and is replaced', () => { assert.deepEqual(brokenResult.results.map(r => r.status), ['error', 'ok']); assert.equal(brokenFactory.count(), 2); });
}
const unavailable = createBatchTaskRunner({ workerFactory() { throw new Error('worker unavailable'); } });
const unavailableResult = await unavailable.run([textTask('a'), textTask('b')]);
check('worker creation failure is never a synchronous fallback', () => assert.equal(unavailableResult.stats.error, 2));
const invalidHost = createBatchTaskRunner({ workerFactory: () => ({}) });
const invalidHostResult = await invalidHost.run([textTask('bad-host')]);
check('invalid execution hosts produce an explicit row error', () => assert.equal(invalidHostResult.results[0].error.code, 'TASK_WORKER_UNAVAILABLE'));
invalidHost.dispose();
const budget = createBatchTaskRunner({ workerFactory: factory(), limits: { maxTotalBytes: 6 } });
const budgetResult = await budget.run([textTask('a'), textTask('b')]);
check('cumulative budget keeps completed output and reports omitted later output', () => { assert.equal(budgetResult.results[0].text, 'QQ=='); assert.equal(budgetResult.results[1].status, 'error'); assert(budgetResult.results[1].omitted.length); assert.equal(budgetResult.stats.retainedBytes, 4); });
const inputBudget = createBatchTaskRunner({ workerFactory: factory(), limits: { maxTotalInputBytes: 0 } });
await rejects('batch input budget is checked before snapshot allocation', 'TASK_INPUT_BUDGET', () => inputBudget.run([textTask('a')]));
slow.dispose(); await rejects('disposed runners cannot start new jobs', 'TASK_DISPOSED', () => slow.run([textTask('disposed')]));
real.dispose(); aborted.dispose(); timed.dispose(); stale.dispose(); unavailable.dispose(); budget.dispose(); inputBudget.dispose();
await Promise.all(terminations);
console.log(JSON.stringify({ verdict: 'PASS', checks: checks.length, cases: checks, timings,
  artifacts: result.results[7].files.map(f => ({ name: f.name, size: f.size, sha256: createHash('sha256').update(f.bytes).digest('hex') })), workerHostsTerminated: terminations.length }));
