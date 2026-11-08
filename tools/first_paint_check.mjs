import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
const option = (name, fallback) => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback;
const base = option('--base-url', 'http://127.0.0.1:8180/'), engine = option('--browser', 'chromium'), channel = option('--channel', undefined), shots = option('--screenshots-dir', undefined);
assert(['localhost', '127.0.0.1'].includes(new URL(base).hostname));
const pw = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await pw[engine].launch({ headless: true, ...(channel ? { channel } : {}) });
let checks = 0;
const check = (v, label) => { assert(v, label); checks++; };
const errors = [];
try {
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 }, serviceWorkers: 'block' });
  const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
  const fixture = new URL('__first_paint__', base).href;
  await page.route(fixture, route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head>
    <style>*{box-sizing:border-box}body{margin:0;background:white}.panel{width:160px;height:96px;border-radius:32px;background:#2468ac;margin:20px}.pill{width:180px;height:44px;border-radius:999px;background:#2468ac}.circle{width:44px;height:44px;border-radius:50%;background:#2468ac}.hidden{display:none}</style>
    <link rel="stylesheet" href="${new URL('src/ui/continuousCorners.css', base)}">
    <script src="${new URL('src/ui/continuousCornersRuntime.js', base)}"></script>
    <script>window.framesSeen=[];function observeFrame(){for(const n of document.querySelectorAll('.panel,.pill,.circle')){const r=n.getBoundingClientRect();if(r.width&&r.height)window.framesSeen.push({id:n.id,paint:n.hasAttribute('data-cc-rendered'),reason:window.__EBCTFContinuousCorners.setupContinuousCorners().inspect(n)?.reason});}requestAnimationFrame(observeFrame)}requestAnimationFrame(observeFrame);</script>
    </head><body><div id="initial" class="panel"></div><button id="pill" class="pill">M3</button><button id="circle" class="circle">M3</button><div id="hidden" class="panel hidden"></div></body></html>` }));
  await page.goto(fixture); await page.waitForTimeout(120);
  await page.evaluate(() => {
    const n = document.createElement('div'); n.className = 'panel'; n.id = 'dynamic'; document.body.append(n);
    document.getElementById('hidden').classList.remove('hidden');
  });
  await page.waitForTimeout(120);
  const frames = await page.evaluate(() => framesSeen);
  for (const id of ['initial', 'dynamic', 'hidden']) {
    const samples = frames.filter(f => f.id === id);
    check(samples.length > 0 && samples.every(f => f.paint), `${id}: every visible frame, including first, is already drawn: ${JSON.stringify(samples)} errors=${JSON.stringify(errors)}`);
  }
  for (const id of ['pill', 'circle']) check(frames.filter(f => f.id === id).every(f => !f.paint && ['pill', 'circle'].includes(f.reason)), `${id}: authored M3 shape is never replaced`);
  if (shots) await page.screenshot({ path: join(shots, `first-paint-${engine}-fixture.png`) });

  // Delay the entire application module graph. The static shell must still have
  // its final shape, with no body-wide hiding or loading-mask workaround.
  const app = await context.newPage(); app.on('pageerror', e => errors.push(e.message));
  await app.addInitScript(() => {
    localStorage.setItem('ebctf_locale', 'zh'); window.firstPaintFailures = []; window.firstPaintSeen = new Set();
    const sample = () => {
      const api = window.__EBCTFContinuousCorners?.setupContinuousCorners();
      for (const selector of ['.brand-icon', '.workspace', '.home-studio', '.home-input', '.env-panel', '.exp-dialog', '.op-config .op-params']) {
        for (const n of document.querySelectorAll(selector)) {
          const r = n.getBoundingClientRect(), s = getComputedStyle(n);
          if (!r.width || !r.height || r.bottom < 0 || r.top > innerHeight || s.visibility === 'hidden') continue;
          // Mobile workspace intentionally has no radius.
          if (!/[1-9]/.test(s.borderRadius) && !n.hasAttribute('data-cc-media')) continue;
          firstPaintSeen.add(selector);
          const state = api?.inspect(n);
          if (!state?.applied && !['pill', 'circle'].includes(state?.reason)) firstPaintFailures.push({ selector, reason: state?.reason || 'untracked' });
        }
      }
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  let releaseMain;
  const gate = new Promise(resolve => { releaseMain = resolve; });
  await app.route('**/src/main.js', async route => { await gate; await route.continue(); });
  await app.goto(new URL('#/home', base).href, { waitUntil: 'commit' });
  await app.waitForFunction(() => document.querySelector('.brand-icon')?.hasAttribute('data-cc-rendered'));
  check(await app.locator('.topbar').isVisible(), 'shell stays visible while main module is delayed');
  check(await app.evaluate(() => !document.documentElement.hidden && getComputedStyle(document.body).visibility === 'visible'), 'no whole-page hiding workaround');
  releaseMain(); await app.locator('.home-studio').waitFor();
  await app.locator('#btnFont').click(); await app.locator('.env-panel').waitFor();
  await app.locator('#envMotionSpeed').focus(); await app.keyboard.press('Escape');
  await app.goto(new URL('#/op/chacha20Poly1305', base).href); await app.locator('.op-params').waitFor();
  await app.locator('.exp-btn').first().click(); await app.locator('.exp-dialog').waitFor();
  await app.waitForTimeout(250);
  const evidence = await app.evaluate(() => ({ seen: [...firstPaintSeen], failures: firstPaintFailures }));
  check(evidence.seen.includes('.home-studio') && evidence.seen.includes('.env-panel') && evidence.seen.includes('.exp-dialog'), 'real initial and dynamic component frames observed');
  check(evidence.failures.length === 0, `no authored-corner frame: ${JSON.stringify(evidence)}`);
  check(errors.length === 0, `page errors: ${errors.join('; ')}`);
  console.log(JSON.stringify({ verdict: 'PASS', engine, checks, fixtureFrames: frames.length, evidence, pageErrors: errors }));
} finally { await browser.close(); }
