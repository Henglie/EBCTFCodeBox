import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { resolve } from 'node:path';
import { startLauncher, stopLauncher } from './launcher_test_helpers.mjs';
const suite = process.argv[2] || 'custom_editor_check';
if (!['custom_editor_check', 'feedback_check', 'ui_followup'].includes(suite)) throw new Error('Unknown UI suite');
const report = { stdout: '', stderr: '' };
const { child, port } = await startLauncher(resolve('Windows点我启动.exe'), resolve('.'), report);
try {
  const test = spawn(process.execPath, [`tools/${suite}.mjs`, '--base-url', `http://127.0.0.1:${port}/`, '--channel', 'chrome'], { stdio: 'inherit' });
  const [code] = await once(test, 'exit');
  if (code) process.exitCode = code;
} finally { await stopLauncher(child); }
