// Real-page interaction costs. Run with the same browser/machine before/after.
// --verify adds bounded-work assertions; timings remain measurements, not FPS claims.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const option = (key, fallback) => process.argv.includes(key) ? process.argv[process.argv.indexOf(key) + 1] : fallback;
const pw = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = option('--base-url', 'http://127.0.0.1:8180/'), engine = option('--browser', 'chromium');
const channel = option('--channel', undefined), verify = process.argv.includes('--verify');
assert(['localhost', '127.0.0.1'].includes(new URL(base).hostname));
const browser = await pw[engine].launch({ headless: true, ...(channel ? { channel } : {}) });
const context = await browser.newContext({ viewport: { width: 1366, height: 900 }, serviceWorkers: 'block' });
await context.addInitScript(() => {
  localStorage.setItem('ebctf_locale', 'zh');
  window.perfReads = { bounds: 0, styles: 0 };
  const bounds = Element.prototype.getBoundingClientRect, style = window.getComputedStyle;
  Element.prototype.getBoundingClientRect = function(...args) { window.perfReads.bounds++; return bounds.apply(this, args); };
  window.getComputedStyle = function(...args) { window.perfReads.styles++; return style.apply(this, args); };
  window.perfLongTasks = [];
  if (PerformanceObserver.supportedEntryTypes.includes('longtask')) new PerformanceObserver(list => {
    window.perfLongTasks.push(...list.getEntries().map(e => ({ start: e.startTime, ms: e.duration })));
  }).observe({ type: 'longtask' });
});
await context.route(/^https?:\/\/(?:127\.0\.0\.1|localhost):8181\//, route => route.fulfill({ status: 503, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*', 'Cross-Origin-Resource-Policy': 'cross-origin' }, body: '{}' }));
const page = await context.newPage(), errors = [], results = [];
page.on('pageerror', e => errors.push(e.message));
const cdp = process.argv.includes('--profile') && engine === 'chromium' ? await context.newCDPSession(page) : null;
const snapshot = () => page.evaluate(() => ({ ...window.perfReads, ...window.perfCorners.stats(), now: performance.now() }));
async function measure(label, action) {
  await page.waitForTimeout(300);
  const before = await snapshot();
  if (cdp) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.start'); }
  await action(); await page.waitForTimeout(120);
  let hot;
  if (cdp) {
    const { profile } = await cdp.send('Profiler.stop');
    hot = profile.nodes.filter(n => n.hitCount && n.callFrame.url.includes('/src/')).sort((a, b) => b.hitCount - a.hitCount).slice(0, 6)
      .map(n => ({ fn: n.callFrame.functionName, file: n.callFrame.url.split('/').at(-1), line: n.callFrame.lineNumber + 1, samples: n.hitCount }));
  }
  const after = await snapshot();
  const tasks = await page.evaluate(start => window.perfLongTasks.filter(e => e.start >= start), before.now);
  const result = { label, ms: Math.round(after.now - before.now), bounds: after.bounds - before.bounds, styles: after.styles - before.styles,
    radiusChecks: after.radiusChecks - before.radiusChecks, measured: after.measured - before.measured, drawn: after.drawn - before.drawn,
    longTasks: tasks.length, maxTask: Math.round(Math.max(0, ...tasks.map(t => t.ms))), ...(hot ? { hot } : {}) };
  results.push(result); console.log(JSON.stringify(result)); return result;
}
async function go(route, selector) {
  await page.evaluate(route => { location.hash = `#/${route}`; }, route);
  await page.locator(selector).first().waitFor();
}
try {
  await page.goto(new URL('#/home', base).href); await page.locator('.home-hero').waitFor();
  assert(await page.locator('.home-local-badge').count() === 0, 'Home has no local-workspace capsule');
  await page.evaluate(async () => { window.perfCorners = (await import('./src/ui/continuousCorners.js')).setupContinuousCorners(); await document.fonts.ready; });
  await measure('navigate-all', async () => {
    await go('all', '.allops-card');
    await page.waitForFunction(() => document.querySelectorAll('.allops-card').length === 978);
  });
  const scroll = await measure('all-scroll-24-frames', () => page.evaluate(async () => {
    const node = document.getElementById('workspace');
    for (let i = 0; i < 24; i++) { node.scrollTop = 160 * (i + 1); await new Promise(requestAnimationFrame); }
  }));
  await page.locator('.allops-card').first().scrollIntoViewIfNeeded();
  const hover = await measure('all-hover-24-events', () => page.evaluate(async () => {
    const node = document.querySelector('.allops-card-name');
    for (let i = 0; i < 24; i++) {
      node.dispatchEvent(new PointerEvent(i % 2 ? 'pointerout' : 'pointerover', { bubbles: true, relatedTarget: document.getElementById('workspace') }));
      await new Promise(requestAnimationFrame);
    }
  }));
  await measure('navigate-base64', () => go('op/base64', '#ioIn'));
  const typing = await measure('op-type-24-keys', () => page.locator('#ioIn').pressSequentially('abcdefghijklmnopqrstuvwx', { delay: 16 }));
  await measure('navigate-quickconv', () => go('quickconv', '.qc-input[data-row="hex"]'));
  assert(await page.locator('.qc-toolbar button').filter({ hasText: /^(有符号|无符号)$/ }).count() === 0, 'Both decimal views need no signedness toggle');
  const quick = await measure('quickconv-type-8-keys', () => page.locator('.qc-input[data-row="hex"]').pressSequentially('12345678', { delay: 16 }));
  const identity = await page.locator('.qc-bit').first().evaluate(n => { window.perfBit = n; return !!n; });
  await page.locator('.qc-input[data-row="hex"]').fill('FFFFFFFF');
  assert(await page.locator('.qc-input[data-row="dec"]').inputValue() === '-1');
  assert(await page.locator('.qc-input[data-row="udec"]').inputValue() === '4294967295');
  if (verify) {
    assert(scroll.bounds < 3000, `Scroll geometry reads must not scale as all cards x frames: ${scroll.bounds}`);
    assert(hover.radiusChecks < 150, `Hover must not rescan the entire workspace: ${hover.radiusChecks}`);
    assert(hover.measured < 300, `Hover must not repaint all visible cards: ${hover.measured}`);
    assert(typing.radiusChecks < 500, `Typing must not rediscover unrelated editors: ${typing.radiusChecks}`);
    assert(quick.radiusChecks < 100, `Radix updates must reuse the bit controls: ${quick.radiusChecks}`);
    assert(identity && await page.locator('.qc-bit').first().evaluate(n => n === window.perfBit), 'Radix changes retain the existing bit controls');
    await page.waitForTimeout(500); const idle = await snapshot(); await page.waitForTimeout(300);
    assert((await snapshot()).measured === idle.measured, 'Renderer does no idle polling');
  }
  assert.deepEqual(errors, []);
  console.log(`${engine}${channel ? `/${channel}` : ''}: ${verify ? 'bounded work PASS; ' : ''}pageerror=0`);
} finally { await browser.close(); }
