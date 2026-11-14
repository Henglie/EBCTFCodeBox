import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer, request as httpRequest } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, resolve, sep } from 'node:path';
import { spawn } from 'node:child_process';
import { LOCAL_TOOL_CATALOG, LOCAL_TOOL_MIRRORS } from '../src/core/localToolCatalog.js';
import { renderLocalToolsPage, LOCAL_TOOLS_TEXT } from '../src/ui/localToolsPage.js';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
let checks = 0;
function check(value, label) { assert(value, label); checks++; }
check(typeof renderLocalToolsPage === 'function', 'actual ESM UI import');
check(LOCAL_TOOL_CATALOG.length === 48 && new Set(LOCAL_TOOL_CATALOG.map(value => value.id)).size === 48, 'catalog IDs');
check(Object.keys(LOCAL_TOOL_MIRRORS).join() === 'default,tuna', 'fixed mirror enums');
check(Object.values(LOCAL_TOOLS_TEXT).every(value => value.length === 2), 'bilingual fallback keys');

// A real HTTP handler with real local detection and a strict fake installer.
// No package manager installation is executed by this test server.
const pythonCode = `
import sys, threading, time
sys.dont_write_bytecode = True
import bridge, local_tools
real_runner = local_tools.run_bounded
def controlled(argv, **kw):
    if 'install' not in argv:
        return real_runner(argv, **kw)
    kw['on_chunk']('SIMULATED INSTALL ONLY\\n')
    if argv[-1] == 'gmpy2':
        kw['cancel'].wait(5)
        return {'ok': False, 'reason': 'cancelled', 'exitCode': -1}
    time.sleep(.08)
    return {'ok': argv[-1] != 'numpy', 'reason': '', 'exitCode': 1 if argv[-1] == 'numpy' else 0}
bridge.LOCAL_TOOLS = local_tools.LocalToolsService(runner=controlled)
class Handler(bridge.BridgeHandler):
    def log_message(self, *args): pass
server = bridge.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
print(server.server_port, flush=True)
threading.Thread(target=server.serve_forever, daemon=True).start()
sys.stdin.read()
bridge.LOCAL_TOOLS.close()
server.shutdown()
server.server_close()
`;
const py = spawn(process.env.PY_LAUNCHER || 'py', ['-3.11', '-B', '-c', pythonCode], { cwd: root, stdio: ['pipe', 'pipe', 'pipe'] });
let stderr = '';
py.stderr.on('data', chunk => { stderr += chunk; });
const pyPort = await new Promise((accept, reject) => {
  let output = '';
  const timeout = setTimeout(() => reject(new Error(`Python server startup: ${stderr}`)), 15000);
  py.stdout.on('data', chunk => { output += chunk; if (/^\d+\r?\n/.test(output)) { clearTimeout(timeout); accept(Number(output.trim())); } });
  py.once('error', reject); py.once('exit', code => { if (!output) reject(new Error(`Python exited ${code}: ${stderr}`)); });
});

const server = createServer(async (req, res) => {
  try {
    if (req.url.startsWith('/__api/')) {
      const proxy = httpRequest({ hostname: '127.0.0.1', port: pyPort, method: req.method,
        path: '/api/local-tools/' + req.url.slice('/__api/'.length),
        headers: { ...req.headers, host: `127.0.0.1:${pyPort}` } }, upstream => {
        res.writeHead(upstream.statusCode, upstream.headers); upstream.pipe(res);
      });
      proxy.on('error', error => { res.writeHead(500); res.end(error.message); });
      req.pipe(proxy); return;
    }
    if (req.url === '/' || req.url === '/__test__') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end('<!doctype html><html lang="zh"><meta charset="utf-8"><link rel="stylesheet" href="/src/ui/theme.css"><link rel="stylesheet" href="/src/ui/localToolsPage.css"><body style="margin:0"><main id="host" style="height:100dvh;min-height:0"></main></body></html>');
      return;
    }
    const file = resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname));
    if (!file.startsWith(root + sep) || !/\.(?:js|css)$/.test(file)) { res.writeHead(404); res.end(); return; }
    res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/css; charset=utf-8');
    res.end(await readFile(file));
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(accept => server.listen(0, '127.0.0.1', accept));
const base = `http://127.0.0.1:${server.address().port}/`;
const modulePath = process.env.PLAYWRIGHT_MODULE || join(process.env.APPDATA || '', 'npm/node_modules/playwright');
const pw = createRequire(import.meta.url)(modulePath);
let browser;
try {
  browser = await pw.chromium.launch({ headless: true, channel: process.env.BROWSER_CHANNEL || 'chrome' });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block', permissions: ['clipboard-read', 'clipboard-write'] });
  const external = [], errors = [];
  let bridgeMode = 'offline';
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (!['127.0.0.1', 'localhost'].includes(url.hostname)) { external.push(url.href); await route.abort(); }
    else if (url.port === '8181') await route.fulfill({
      status: bridgeMode === 'legacy' && url.pathname === '/api/health' ? 200 : bridgeMode === 'legacy' ? 404 : 503,
      contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' },
      body: bridgeMode === 'legacy' && url.pathname === '/api/health' ? '{"ok":true,"product":"EBCTFCodeBox","bridge":"native"}' : '{"ok":false,"error":"not found"}',
    });
    else await route.continue();
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base);
  await page.evaluate(async () => {
    window.ui = await import('/src/ui/localToolsPage.js');
    window.view = window.ui.renderLocalToolsPage(document.getElementById('host'));
    await window.view.ready;
  });
  check(await page.locator('.lt-card').count() === 48, 'no-bridge catalog visible');
  check((await page.locator('.lt-status').textContent()).includes('静态部署'), 'no-bridge explanation');
  check(await page.locator('.lt-card button').filter({ hasText: '安装（联网）' }).evaluateAll(nodes => nodes.every(n => n.disabled)), 'no-bridge install disabled');
  check(await page.locator('[data-tool-id="sage"] .lt-command').textContent() === 'sage --version', 'Sage is its own runtime');
  await page.locator('#lt-mirror').selectOption('tuna');
  check((await page.locator('[data-tool-id="sympy"] .lt-command').textContent()).includes('pypi.tuna.tsinghua.edu.cn'), 'pip mirror command');
  check((await page.locator('[data-tool-id="noble-hashes"] .lt-command').textContent()).includes('registry.npmmirror.com'), 'npm mirror command');
  await page.locator('[data-tool-id="sympy"] button').filter({ hasText: '复制命令' }).click();
  check((await page.evaluate(() => navigator.clipboard.readText())).includes('sympy'), 'copy real clipboard');
  await page.locator('input[type="search"]').fill('Cryptodome');
  check(await page.locator('.lt-card').count() === 2, 'module search');
  await page.locator('input[type="search"]').fill('');

  for (const [width, height, dir, theme] of [[1280, 800, 'ltr', 'dark'], [390, 700, 'ltr', 'light'], [320, 560, 'rtl', 'dark']]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(({ dir, theme }) => { document.documentElement.dir = dir; document.documentElement.dataset.theme = theme; }, { dir, theme });
    const fit = await page.locator('.local-tools-page').evaluate(n => ({ scroll: n.scrollWidth, client: n.clientWidth,
      doc: document.documentElement.scrollWidth, viewport: innerWidth, height: n.clientHeight, overflow: n.scrollHeight }));
    check(fit.scroll <= fit.client + 1 && fit.doc <= fit.viewport + 1, `viewport fit ${width} ${dir}: ${JSON.stringify(fit)}`);
    check(fit.overflow > fit.height, `page scrolls ${width}`);
  }
  bridgeMode = 'legacy';
  await page.evaluate(async () => {
    window.view = window.ui.renderLocalToolsPage(document.getElementById('host'));
    await window.view.ready;
  });
  check((await page.locator('.lt-status').textContent()).includes('原生桥需接入'), 'legacy native bridge without new API degrades explicitly');
  check(await page.locator('.lt-card').count() === 48, 'legacy native bridge keeps full catalog');
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.evaluate(async () => {
    document.documentElement.dir = 'ltr'; document.documentElement.lang = 'en';
    window.apiCalls = [];
    window.request = async (action, payload, { signal } = {}) => {
      window.apiCalls.push({ action, payload });
      const r = await fetch('/__api/' + action, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal });
      const value = await r.json(); if (!r.ok) throw new Error(value.error); return value;
    };
    window.view = window.ui.renderLocalToolsPage(document.getElementById('host'), { request: window.request });
    await window.view.ready;
  });
  check((await page.locator('h1').textContent()) === 'Local environment tools', 'English fallback');
  check((await page.locator('.lt-status').textContent()).includes('completed'), 'real HTTP metadata');
  const interpreters = await page.locator('#lt-python option').count();
  check(interpreters >= 2, 'real multiple interpreters enumerated');
  check((await page.locator('[data-tool-id="sympy"] .lt-badge').textContent()).includes('1.14.0'), 'actual installed Python metadata');
  check((await page.locator('[data-tool-id="sage"] .lt-badge').textContent()).includes('Missing'), 'Sage accurately missing');
  check((await page.locator('[data-tool-id="python"] .lt-command').textContent()).includes('Python311'), 'runtime version command selects actual interpreter');
  check((await page.locator('[data-tool-id="7z"] .lt-command').textContent()).includes('7-Zip'), 'runtime version command includes non-PATH executable');
  await page.locator('#lt-python').selectOption({ index: 1 });
  await page.waitForFunction(() => !document.getElementById('lt-python').disabled);
  check(await page.evaluate(() => window.apiCalls.at(-1).payload.pythonId === document.getElementById('lt-python').value), 'selected interpreter sent by opaque ID');
  await page.locator('#lt-python').selectOption({ index: 0 });
  await page.waitForFunction(() => !document.getElementById('lt-python').disabled);
  const scopes = await page.locator('#lt-scope option').count();
  if (scopes > 1) {
    await page.locator('#lt-scope').selectOption({ index: 1 });
    await page.waitForFunction(() => !document.getElementById('lt-scope').disabled);
    check(await page.locator('[data-tool-id="mathjs"] button').filter({ hasText: 'Install (network)' }).isDisabled(), 'read-only npm scope cannot install');
    await page.locator('#lt-scope').selectOption('managed');
    await page.waitForFunction(() => !document.getElementById('lt-scope').disabled);
  }
  check(await page.evaluate(() => !window.apiCalls.some(call => call.action === 'install')), 'detection and mirror choices do not install');
  await page.locator('[data-tool-id="sympy"] button').filter({ hasText: 'Install (network)' }).click();
  await page.waitForFunction(() => document.querySelector('.lt-jobs').textContent.includes('exited successfully'));
  check((await page.locator('.lt-job-log').textContent()).includes('SIMULATED INSTALL ONLY'), 'simulated success log');
  await page.waitForFunction(() => !document.querySelector('.lt-primary').disabled);
  await page.locator('[data-tool-id="numpy"] button').filter({ hasText: 'Install (network)' }).click();
  await page.waitForFunction(() => document.querySelector('.lt-jobs').textContent.includes('Installation failed'));
  check((await page.locator('.lt-jobs').textContent()).includes('exit 1'), 'simulated failure exit');
  await page.waitForFunction(() => !document.querySelector('.lt-primary').disabled);
  await page.locator('[data-tool-id="gmpy2"] button').filter({ hasText: 'Install (network)' }).click();
  await page.locator('.lt-jobs button').filter({ hasText: 'Cancel installation' }).click();
  await page.waitForFunction(() => document.querySelector('.lt-jobs').textContent.includes('not rolled back'));
  check((await page.locator('.lt-job-log').textContent()).includes('SIMULATED'), 'simulated cancellation');
  await page.waitForFunction(() => !document.querySelector('.lt-primary').disabled);
  await page.evaluate(async () => {
    window.view = window.ui.renderLocalToolsPage(document.getElementById('host'), { request: window.request });
    await window.view.ready;
  });
  await page.waitForFunction(() => !document.querySelector('.lt-jobs').hidden);
  check((await page.locator('.lt-jobs').textContent()).includes('not rolled back'), 'logs retained across navigation');
  await page.evaluate(() => { window.view.dispose(); document.getElementById('host').replaceChildren(); });
  const before = await page.evaluate(() => window.apiCalls.length);
  await page.waitForTimeout(1100);
  check(await page.evaluate(() => window.apiCalls.length) === before, 'disposed page stops polling');

  await page.evaluate(async () => {
    const { renderEnvPanel } = await import('/src/ui/envPanel.js');
    renderEnvPanel(document.getElementById('host'));
  });
  check(await page.locator('.env-tool-row').count() === 0, 'old tool detail list migrated');
  check(await page.locator('.env-theme-box').count() === 1 && await page.locator('.env-reset-box').count() === 1, 'other environment settings retained');
  await page.locator('.env-panel button').filter({ hasText: 'Local environment tools' }).or(page.locator('.env-panel button').filter({ hasText: '本机环境工具管理' })).click();
  check(new URL(page.url()).hash === '#/tools', 'environment entry navigates to tools route');
  check(external.length === 0, `no automatic external traffic: ${external.join(',')}`);
  check(errors.length === 0, `browser runtime errors: ${errors.join(',')}`);
  console.log(`PASS ${checks} checks; Chromium, real local metadata + fake installs; no packages installed.`);
  await context.close();
} finally {
  if (browser) await browser.close();
  await new Promise(accept => server.close(accept));
  py.stdin.end();
  await new Promise(accept => { if (py.exitCode != null) accept(); else { py.once('exit', accept); setTimeout(() => { py.kill(); accept(); }, 5000).unref(); } });
}
