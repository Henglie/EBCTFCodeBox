import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname, sep, join } from 'node:path';

const option = (key, fallback) => process.argv.includes(key) ? process.argv[process.argv.indexOf(key) + 1] : fallback;
const baseline = process.argv.includes('--baseline');
const output = option('--output', undefined);
const root = resolve('.');
const server = createServer(async (req, res) => {
  try {
    const path = resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname).replace(/\/$/, '/index.html'));
    if (!path.startsWith(root + sep)) throw new Error('path');
    res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.json': 'application/json' })[extname(path)] || 'application/octet-stream');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    res.end(await readFile(path));
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const base = `http://127.0.0.1:${server.address().port}/`;
const pw = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || join(process.env.APPDATA, 'npm/node_modules/playwright'));
const browser = await pw.chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1366, height: 900 }, serviceWorkers: 'block' });
await context.addInitScript(() => localStorage.setItem('ebctf_locale', 'zh'));
await context.route(/^https?:\/\/(?:127\.0\.0\.1|localhost):8181\//, r => r.fulfill({ status: 503, headers: { 'Access-Control-Allow-Origin': '*' }, body: '{}' }));
const page = await context.newPage(), errors = [], measurements = [];
page.on('pageerror', error => errors.push(error.message));
let checks = 0;
const check = (value, label) => { if (!baseline) { assert(value, label); checks++; } };
async function shot(name) { if (output) { await mkdir(output, { recursive: true }); await page.screenshot({ path: join(output, `${name}.png`) }); } }
try {
  await page.goto(base);
  await page.locator('.magic-strength-btn').click();
  await page.locator('.ds-cat-head').first().click();
  await page.locator('.ds-op-row').first().hover();
  await page.waitForTimeout(300);
  measurements.push(await page.locator('.ds-list').evaluate(n => ({ section: 'strength', rows: [...n.querySelectorAll('.ds-cat-headrow,.ds-op-row')].slice(0, 12).map(row => ({ cls: row.className, box: row.getBoundingClientRect().toJSON(), checkbox: row.querySelector('input')?.getBoundingClientRect().toJSON() })) })));
  await shot('strength');
  await page.evaluate(async () => (await import('/src/ui/decodeStrength.js')).closeDecodeStrength(true));
  await page.goto(base + '#/op/base64');
  await page.locator('#ioIn').waitFor();
  measurements.push(await page.locator('.io-pane-head').first().evaluate(n => ({ section: 'toolbar', width: n.clientWidth, direct: n.querySelectorAll('.io-pane-tools > button').length, extra: n.querySelectorAll('.io-tools-extra button').length })));
  check(await page.locator('.io-pane-input .io-tools-more > summary').count() === 1 && await page.locator('.io-pane-input .io-tools-more > summary').isHidden(), 'input toolbar does not fold before the title boundary');
  check(await page.locator('.io-pane-output .io-tools-more > summary').isHidden(), 'output toolbar does not fold before the title boundary');
  await shot('toolbar');
  await page.goto(base + '#/tools');
  await page.locator('.lt-card').first().waitFor();
  await shot('tools');
  await page.goto(base + '#/op/freqDist');
  await page.locator('.ci-edit-btn').click();
  await page.locator('.ci-editor-wrap .cm-content').waitFor();
  await page.locator('.ci-tools-toggle').click();
  measurements.push(await page.locator('.ci-foot').evaluate(n => ({ section: 'footer', buttons: [...n.querySelectorAll('button')].slice(0, 10).map(b => ({ text: b.textContent, box: b.getBoundingClientRect().toJSON() })) })));
  await shot('editor');
  check(errors.length === 0, errors.join('\n'));
  if (output) await writeFile(join(output, 'measurements.json'), JSON.stringify({ baseline, checks, errors, measurements }, null, 2));
  console.log(JSON.stringify({ baseline, checks, errors, measurements }));
} finally { await browser.close(); await new Promise(done => server.close(done)); }
