import { getOp } from './registry.js';
import { OP_FILE_MAP } from './lazyTables.generated.js';
import { withLimitContext } from './limitGuard.js';
import { legacyInvocation, inputError } from './inputContract.js';
import { BATCH_TASK_OPS, normalizeTask, normalizeTaskResult } from './batchTaskContract.js';

/** Called only by a batch-owned execution host, never the shared workbench worker. */
export async function executeBatchTask(request, options = {}) {
  const rollout = Array.isArray(options.rollout) ? options.rollout : BATCH_TASK_OPS;
  if (!rollout.includes(request?.opId)) throw inputError('TASK_UNSUPPORTED', 'Operation is outside the current batch rollout');
  let op = getOp(request.opId);
  if (!op || op.__stub) {
    const file = OP_FILE_MAP[request.opId];
    if (!file) throw inputError('TASK_MODULE', 'Missing operation module');
    await import(file);
    op = getOp(request.opId);
  }
  if (!op || op.__stub) throw inputError('TASK_MODULE', 'Operation did not register');
  const task = normalizeTask(op, request, options), call = legacyInvocation(op, task);
  const output = await withLimitContext(call.params, () => op[call.direction].call(op, call.input, call.params));
  return normalizeTaskResult(task, output, options);
}
