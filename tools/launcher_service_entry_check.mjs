import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
const child = spawn(process.execPath, ['mcp/launcher-service.mjs', '--root', process.cwd()], {
  env: { ...process.env, EBCRYPTO_MCP_ENABLED: 'true', EBCRYPTO_MCP_PORT: '0' }, stdio: ['pipe', 'pipe', 'pipe'],
});
let output = '', diagnostic = '';
child.stdout.on('data', value => { output += value; });
child.stderr.on('data', value => { diagnostic += value; });
const watchdog = setTimeout(() => child.kill(), 15000);
try {
  for (let i = 0; !output.includes('\n') && i < 100; i++) await new Promise(done => setTimeout(done, 50));
  const ready = JSON.parse(output.trim());
  assert.equal(ready.ok, true, diagnostic); assert.equal(ready.enabled, true);
  child.stdin.end();
  await once(child, 'exit');
  assert.equal(child.exitCode, 0, diagnostic);
  console.log('PASS: direct Node startup, private ready record, parent stdin lease closes service');
} finally { clearTimeout(watchdog); if (child.exitCode === null && child.signalCode === null) child.kill(); }
