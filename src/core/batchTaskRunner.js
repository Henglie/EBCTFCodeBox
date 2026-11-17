import { taskFailure, taskLimits, taskDataSize } from './batchTaskContract.js';
import { inputError } from './inputContract.js';

let nextJob = 0;
const defaultWorker = () => {
  if (typeof Worker !== 'function') throw inputError('TASK_WORKER_UNAVAILABLE', 'Batch execution requires a module Worker');
  return new Worker(new URL('./batchTaskWorker.js', import.meta.url), { type: 'module' });
};
function positiveInteger(value, label, maximum) {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw inputError('TASK_OPTIONS', 'Invalid ' + label);
  return value;
}
function resultSize(result, task) {
  if (!result || result.schemaVersion !== 1 || result.taskId !== task.taskId || result.opId !== task.opId || result.attempt !== (task.attempt ?? 1)
    || !['ok', 'error', 'cancelled', 'timeout', 'skipped'].includes(result.status) || typeof result.text !== 'string' || !Array.isArray(result.files)) throw inputError('RESULT_PROTOCOL', 'Invalid worker result');
  let bytes = new TextEncoder().encode(result.text).byteLength;
  for (const file of result.files) {
    if (!file || typeof file.name !== 'string' || typeof file.mime !== 'string' || !(file.bytes instanceof Uint8Array) || file.size !== file.bytes.byteLength) throw inputError('RESULT_PROTOCOL', 'Invalid worker artifact');
    bytes += file.size;
  }
  return bytes;
}

/** Independent runner instance: cancel/dispose never affect another workbench. */
export function createBatchTaskRunner(options = {}) {
  const workerFactory = options.workerFactory ?? defaultWorker;
  if (typeof workerFactory !== 'function') throw inputError('TASK_OPTIONS', 'workerFactory must be a function');
  const limits = taskLimits(options.limits);
  const concurrency = positiveInteger(options.concurrency ?? 1, 'concurrency', 4);
  const defaultTimeout = positiveInteger(options.timeoutMs ?? 30000, 'timeoutMs', 3600000);
  let active = null, disposed = false;

  function stopLane(lane) {
    const worker = lane.worker; lane.worker = null;
    if (worker) { try { Promise.resolve(worker.terminate()).catch(() => {}); } catch { /* Already stopped. */ } }
  }
  function cancel(reason = 'Batch cancelled') {
    if (!active || active.cancelled) return false;
    active.cancelled = true; active.reason = typeof reason === 'string' && reason ? reason : 'Batch cancelled';
    for (const lane of active.lanes) {
      lane.cancel?.(); stopLane(lane);
    }
    return true;
  }
  async function run(requests, runOptions = {}) {
    if (disposed) throw inputError('TASK_DISPOSED', 'Runner is disposed');
    if (active) throw inputError('TASK_BATCH_BUSY', 'A batch is already running on this runner');
    if (!Array.isArray(requests) || requests.length > limits.maxTasks) throw inputError('TASK_COUNT', 'Batch task count exceeds its budget');
    const ids = new Set(), rows = [];
    let inputBytes = 0;
    for (const task of requests) {
      if (!task || typeof task.taskId !== 'string' || !task.taskId || task.taskId.length > 128 || /[\x00-\x1f\x7f]/.test(task.taskId)) throw inputError('TASK_ID', 'Each row needs a nonempty taskId');
      if (ids.has(task.taskId)) throw inputError('TASK_DUPLICATE_ID', 'Duplicate taskId: ' + task.taskId);
      ids.add(task.taskId);
      const size = taskDataSize(task);
      inputBytes += size;
      if (inputBytes > limits.maxTotalInputBytes) throw inputError('TASK_INPUT_BUDGET', 'Cumulative batch input exceeds its budget');
      if (size > limits.maxInputBytes) rows.push({ task: { taskId: task.taskId, opId: task.opId, attempt: task.attempt }, error: inputError('TASK_INPUT_BUDGET', 'Row input exceeds its budget') });
      else {
        try { rows.push({ task: structuredClone(task) }); }
        catch (error) { rows.push({ task: { taskId: task.taskId, opId: task.opId, attempt: task.attempt }, error: inputError('TASK_CLONE', error.message) }); }
      }
    }
    const timeoutMs = positiveInteger(runOptions.timeoutMs ?? defaultTimeout, 'timeoutMs', 3600000);
    const job = { jobId: 'batch-' + (++nextJob), cancelled: false, reason: '', lanes: [], next: 0, retainedBytes: 0, warnings: [] };
    active = job;
    const results = new Array(requests.length);
    const onAbort = () => cancel('Batch aborted');
    const signal = runOptions.signal;
    const report = (index, task, result) => {
      results[index] = result;
      if (typeof runOptions.onProgress === 'function') {
        try { runOptions.onProgress({ jobId: job.jobId, index, taskId: task.taskId, result }); }
        catch (error) { job.warnings.push(error?.message || String(error)); }
      }
    };
    function execute(lane, task) {
      if (job.cancelled) return Promise.resolve(taskFailure(task, inputError('TASK_CANCELLED', job.reason), 'cancelled'));
      return new Promise(resolve => {
        let finished = false, timer, worker;
        const finish = (result, recycle = false) => {
          if (finished) return;
          finished = true; clearTimeout(timer); lane.cancel = null;
          worker?.removeEventListener?.('message', onMessage);
          worker?.removeEventListener?.('error', onError);
          worker?.removeEventListener?.('messageerror', onMessageError);
          if (recycle) stopLane(lane);
          resolve(result);
        };
        const onMessage = event => {
          const m = event.data;
          // Messages from an old run/attempt or a replaced worker have no owner.
          if (finished || lane.worker !== worker || m?.type !== 'result' || m.jobId !== job.jobId || m.taskId !== task.taskId || m.attempt !== (task.attempt ?? 1)) return;
          try {
            const size = resultSize(m.result, task);
            if (size + job.retainedBytes > limits.maxTotalBytes) {
              const result = taskFailure(task, inputError('RESULT_BATCH_BUDGET', 'Cumulative retained batch output exceeds its budget'));
              result.omitted = [{ kind: 'result', bytes: size, files: m.result.files.length, reason: 'RESULT_BATCH_BUDGET' }];
              finish(result); return;
            }
            job.retainedBytes += size;
            finish(m.result);
          } catch (error) { finish(taskFailure(task, error), true); }
        };
        const onError = event => {
          event.preventDefault?.();
          finish(taskFailure(task, inputError('TASK_WORKER_ERROR', event.message || 'Batch worker failed')), true);
        };
        const onMessageError = () => finish(taskFailure(task, inputError('RESULT_PROTOCOL', 'Cannot decode worker message')), true);
        lane.cancel = () => finish(taskFailure(task, inputError('TASK_CANCELLED', job.reason), 'cancelled'), true);
        try {
          worker = lane.worker || (lane.worker = workerFactory());
          if (!worker || !['addEventListener', 'removeEventListener', 'postMessage', 'terminate'].every(key => typeof worker[key] === 'function')) throw inputError('TASK_WORKER_UNAVAILABLE', 'Invalid execution host');
          worker.addEventListener('message', onMessage);
          worker.addEventListener('error', onError);
          worker.addEventListener('messageerror', onMessageError);
          timer = setTimeout(() => finish(taskFailure(task, inputError('TASK_TIMEOUT', 'Batch task exceeded its execution deadline'), 'timeout'), true), timeoutMs);
          // Clone, never transfer input buffers: caller-owned files remain usable.
          worker.postMessage({ type: 'run', jobId: job.jobId, task,
            limits: { ...limits, maxTotalBytes: Math.max(0, limits.maxTotalBytes - job.retainedBytes) }, allowOverLimit: runOptions.allowOverLimit === true });
        } catch (error) { finish(taskFailure(task, error), true); }
      });
    }
    async function laneLoop(lane) {
      while (!job.cancelled && job.next < rows.length) {
        const index = job.next++, { task, error } = rows[index];
        if (error) { report(index, task, taskFailure(task, error)); continue; }
        const result = await execute(lane, task);
        report(index, task, result);
      }
    }
    try {
      signal?.addEventListener('abort', onAbort, { once: true });
      if (signal?.aborted) onAbort();
      const lanes = Math.min(concurrency, requests.length);
      for (let i = 0; i < lanes; i++) job.lanes.push({ worker: null, cancel: null });
      await Promise.all(job.lanes.map(laneLoop));
      for (let i = 0; i < rows.length; i++) if (!results[i]) report(i, rows[i].task, taskFailure(rows[i].task, inputError('TASK_SKIPPED', job.reason || 'Task was not dispatched'), 'skipped'));
      const stats = { total: results.length, ok: 0, error: 0, cancelled: 0, timeout: 0, skipped: 0, retainedBytes: job.retainedBytes };
      for (const result of results) stats[result.status]++;
      return { schemaVersion: 1, jobId: job.jobId, results, cancelled: job.cancelled, reason: job.reason, stats, warnings: job.warnings };
    } finally {
      signal?.removeEventListener('abort', onAbort);
      for (const lane of job.lanes) stopLane(lane);
      if (active === job) active = null;
    }
  }
  return { run, cancel, dispose() { disposed = true; cancel('Runner disposed'); }, get busy() { return active !== null; } };
}
