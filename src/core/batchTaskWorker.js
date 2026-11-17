import { executeBatchTask } from './batchTaskExecution.js';
import { taskFailure } from './batchTaskContract.js';
import { inputError } from './inputContract.js';

let busy = false;
self.onmessage = async event => {
  const message = event.data;
  if (!message || message.type !== 'run') return;
  const { jobId, task, limits, allowOverLimit } = message;
  const reply = result => {
    const buffers = [...new Set(result.files.map(f => f.bytes.buffer))];
    self.postMessage({ type: 'result', jobId, taskId: task.taskId, attempt: task.attempt ?? 1, result }, buffers);
  };
  if (busy) { reply(taskFailure(task, inputError('TASK_WORKER_BUSY', 'Execution host is already running a task'))); return; }
  busy = true;
  try {
    const result = await executeBatchTask(task, { limits, allowOverLimit: allowOverLimit === true });
    try { reply(result); }
    catch { reply(taskFailure(task, inputError('RESULT_CLONE', 'Result could not cross the worker boundary'))); }
  } catch (error) {
    try { reply(taskFailure(task, error)); }
    catch { reply(taskFailure(task, inputError('RESULT_CLONE', 'Error metadata could not cross the worker boundary'))); }
  }
  finally { busy = false; }
};
self.postMessage({ type: 'ready' });
