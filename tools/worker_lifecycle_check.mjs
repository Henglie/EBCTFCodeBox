import assert from 'node:assert/strict';
const workers = [];
class WorkerFixture extends EventTarget {
  constructor() { super(); this.requests = []; this.stopped = false; workers.push(this); }
  postMessage(message) { this.requests.push(message); }
  terminate() { this.stopped = true; }
}
const original = globalThis.Worker;
globalThis.Worker = WorkerFixture;
try {
  const { runOpOffThread, cancelOpRun, opRunBusy } = await import('../src/core/opRunClient.js');
  const first = runOpOffThread('fixture', 'first').catch(error => error.message);
  assert(opRunBusy());
  assert(cancelOpRun());
  assert.equal(await first, 'cancelled');
  const second = runOpOffThread('fixture', 'second');
  const stale = new Event('error', { cancelable: true }); workers[0].dispatchEvent(stale);
  assert(stale.defaultPrevented);
  assert(opRunBusy());
  assert(!workers[1].stopped);
  workers[1].dispatchEvent(new MessageEvent('message', { data: { type: 'final', runId: workers[1].requests[0].runId, out: 'current result' } }));
  assert.equal(await second, 'current result');
  assert(!opRunBusy());
  const third = runOpOffThread('fixture', 'third').catch(error => error.message);
  const currentError = new Event('error', { cancelable: true }); workers[1].dispatchEvent(currentError);
  assert(currentError.defaultPrevented);
  assert.equal(await third, '运行线程异常中止');
  assert(!opRunBusy());
  assert(workers[1].stopped);
  console.log(JSON.stringify({ verdict: 'PASS', checks: 12 }));
} finally { if (original === undefined) delete globalThis.Worker; else globalThis.Worker = original; }
