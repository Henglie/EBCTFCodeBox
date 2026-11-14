import http from 'node:http';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
export async function freePort() {
  const server = net.createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const port = server.address().port; await new Promise(done => server.close(done)); return port;
}
export function request(port, path, headers = {}, method = 'GET', hostname = '127.0.0.1') {
  return new Promise((done, reject) => {
    const req = http.request({ hostname, port, path, method, headers }, res => {
      const chunks = []; res.on('data', data => chunks.push(data)); res.on('error', reject);
      res.on('end', () => done({ status: res.statusCode, headers: res.headers, rawHeaders: res.rawHeaders, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject); req.setTimeout(3000, () => req.destroy(new Error('HTTP timeout'))); req.end();
  });
}
export async function stopLauncher(child) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit'); child.kill(); await exited;
}
export async function startLauncher(executable, root, report, extra = []) {
  report.binarySha256 = createHash('sha256').update(await readFile(executable)).digest('hex');
  const port = await freePort();
  const child = spawn(executable, ['--root', root, '--port', String(port), '--no-open', '--no-bridge', '--no-panel', ...extra], {
    windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, EBCRYPTO_MCP_ENABLED: '0' },
  });
  let error;
  child.on('error', value => { error = value; });
  child.stdout.on('data', value => { report.stdout += value; }); child.stderr.on('data', value => { report.stderr += value; });
  const watchdog = setTimeout(() => child.kill(), 18000); watchdog.unref();
  child.once('exit', () => clearTimeout(watchdog));
  try {
    for (let i = 0; i < 60; i++) {
      if (error) throw error;
      if (child.exitCode !== null || child.signalCode !== null) throw new Error('launcher exited: ' + report.stderr);
      try { await request(port, '/'); return { child, port }; } catch { /* wait */ }
      await new Promise(done => setTimeout(done, 50));
    }
    throw new Error('launcher did not listen');
  } catch (failure) { await stopLauncher(child); throw failure; }
}
