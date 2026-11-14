import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import net from 'node:net';
import { resolve } from 'node:path';
import { freePort, request, stopLauncher } from './launcher_test_helpers.mjs';
const exeAt = process.argv.indexOf('--exe');
const executable = resolve(exeAt < 0 ? 'Windows点我启动.exe' : process.argv[exeAt + 1]);
let checks = 0;
for (const token of ['', 'test-local-token']) {
  const port = await freePort(), mcp = await freePort();
  const app = spawn(executable,
    ['--root', resolve('.'), '--port', String(port), '--no-bridge', '--no-open', '--panel'],
    { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env,
      EBCRYPTO_MCP_ENABLED: 'true', EBCRYPTO_MCP_PORT: String(mcp), EBCRYPTO_MCP_TOKEN: token, EBCRYPTO_SERVICE_DEBUG: '1' } });
  let output = ''; app.stdout.on('data', data => { output += data; }); app.stderr.on('data', data => { output += data; });
  const timer = setTimeout(() => app.kill(), 19000);
  try {
    let ready = false;
    for (let i = 0; i < 100; i++) {
      if (app.exitCode !== null || app.signalCode !== null) break;
      try { const r = await request(port, '/'); if (r.status === 200) { ready = true; break; } } catch { /* wait */ }
      await new Promise(done => setTimeout(done, 100));
    }
    assert.ok(ready, output); checks++;
    assert.ok(output.includes('HTTP MCP ready:'), output);
    const call = async (method, params, authorization = token) => {
      const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Connection: 'close' };
      if (authorization) headers.Authorization = 'Bearer ' + authorization;
      return fetch(`http://127.0.0.1:${mcp}/mcp`, { method: 'POST', headers,
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(5000) });
    };
    const response = await call('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'native-check', version: '1' } });
    assert.equal(response.status, 200, output); checks++;
    const decoded = await call('tools/call', { name: 'ebctf_run_op', arguments: { opId: 'base64', direction: 'decode', input: 'SGVsbG8=' } });
    assert.ok(JSON.stringify(await decoded.json()).includes('Hello')); checks++;
    if (token) { assert.equal((await call('tools/list', {}, 'wrong')).status, 401); checks++; }
    if (!token) {
      app.stdin.write('1\n');
      for (let i = 0; i < 50 && output.split('HTTP MCP ready:').length < 3; i++) await new Promise(done => setTimeout(done, 50));
      assert.ok(output.split('HTTP MCP ready:').length >= 3, output); checks++;
      assert.equal((await call('ping', {})).status, 200); checks++;
    }
    app.stdin.write('0\n');
    await Promise.race([once(app, 'exit'), new Promise((_, reject) => setTimeout(() => reject(new Error('graceful launcher exit timed out')), 4000))]);
    let closed = false;
    for (let i = 0; i < 20; i++) {
      try { await request(mcp, '/mcp'); } catch { closed = true; break; }
      await new Promise(done => setTimeout(done, 50));
    }
    assert.ok(closed, 'MCP port survives launcher exit'); checks++;
  } finally { clearTimeout(timer); await stopLauncher(app); }
}
if (process.argv.includes('--tools')) {
  const reservation = net.createServer();
  reservation.listen(8181, '127.0.0.1'); await once(reservation, 'listening');
  await new Promise(done => reservation.close(done));
  const port = await freePort();
  const app = spawn(executable,
    ['--root', resolve('.'), '--port', String(port), '--no-mcp', '--no-open', '--panel'],
    { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, EBCRYPTO_SERVICE_DEBUG: '1' } });
  let output = ''; app.stdout.on('data', value => { output += value; }); app.stderr.on('data', value => { output += value; });
  const timer = setTimeout(() => app.kill(), 19000);
  try {
    for (let i = 0; i < 50; i++) {
      try { if ((await request(port, '/')).status === 200) break; } catch { /* wait */ }
      await new Promise(done => setTimeout(done, 50));
    }
    const call = async (action, payload) => {
      const response = await fetch(`http://127.0.0.1:8181/api/local-tools/${action}`, { method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: `http://127.0.0.1:${port}` },
        body: JSON.stringify(payload, null, 2), signal: AbortSignal.timeout(15000) });
      return { status: response.status, body: await response.json() };
    };
    const pending = call('detect', {});
    assert.equal((await request(port, '/manifest.json')).status, 200); checks++;
    const detected = await pending;
    assert.equal(detected.status, 200, JSON.stringify(detected) + output); checks++;
    assert.equal(detected.body.catalogCount, 48); checks++;
    const pythonId = detected.body.selected.pythonId;
    const plan = await call('plan', { id: 'sympy', pythonId, mirror: 'tuna' });
    assert.equal(plan.status, 200, JSON.stringify(plan)); checks++;
    assert.ok(JSON.stringify(plan.body).includes('https://pypi.tuna.tsinghua.edu.cn/simple')); checks++;
    const rejected = await call('plan', { id: 'sympy', pythonId, mirror: 'tuna', shell: 'anything' });
    assert.equal(rejected.status, 400); checks++;
    app.stdin.write('0\n'); await once(app, 'exit');
    let closed = false; try { await request(8181, '/api/health'); } catch { closed = true; }
    assert.ok(closed, 'native bridge listener closes'); checks++;
  } finally { clearTimeout(timer); await stopLauncher(app); }
}
console.log(JSON.stringify({ result: 'PASS', checks, nativeAutoMcp: true, tokenModes: 2, gracefulExit: true,
  nativeTools: process.argv.includes('--tools') }));
