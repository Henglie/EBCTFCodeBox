import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
const option = (key, fallback) => process.argv.includes(key) ? process.argv[process.argv.indexOf(key) + 1] : fallback;
const pw = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = option('--base-url', 'http://127.0.0.1:8180/'), engine = option('--browser', 'chromium'), channel = option('--channel', undefined), shots = option('--screenshots-dir', undefined);
assert(['localhost', '127.0.0.1'].includes(new URL(base).hostname));
const browser = await pw[engine].launch({ headless: true, ...(channel ? { channel } : {}) });
let checks = 0;
const check = (v, label) => { assert(v, label); checks++; };
const contexts = [], errors = [], evidence = [];
async function context(touch = false) {
  const ctx = await browser.newContext({ viewport: { width: touch ? 320 : 1366, height: touch ? 844 : 768 }, hasTouch: touch, serviceWorkers: 'block' });
  await ctx.route(/^https?:\/\/(?:127\.0\.0\.1|localhost):8181\//, route => route.fulfill({ status: 503, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*', 'Cross-Origin-Resource-Policy': 'cross-origin' }, body: '{"error":"bridge unavailable in frontend test"}' }));
  await ctx.addInitScript(() => localStorage.setItem('ebctf_locale', 'zh'));
  contexts.push(ctx);
  const page = await ctx.newPage(); page.on('pageerror', e => errors.push(e.message));
  return page;
}
async function measure(page) {
  await page.waitForTimeout(400);
  if (page.viewportSize().width >= 1024) await page.waitForFunction(() => {
    const controls = [...document.querySelectorAll('.op-data .io-area, .op-config .io-coding-bar select')];
    return controls.length >= 4 && controls.every(node => node.hasAttribute('data-cc-rendered'));
  }, null, { timeout: 10000 });
  return page.evaluate(async () => {
    const api = (await import(new URL('src/ui/continuousCorners.js', document.baseURI).href)).setupContinuousCorners();
    const rect = n => { const r = n.getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; };
    return { profile: api.stats().profile, overflow: document.getElementById('workspace').scrollWidth > document.getElementById('workspace').clientWidth + 1,
      settings: document.querySelectorAll('.op-config .op-params .io-coding-bar').length,
      panes: [...document.querySelectorAll('.op-data .io-pane')].map(pane => {
        const scope = pane.classList.contains('io-pane-input') ? 'input' : 'output';
        const bar = document.querySelector(`.op-params [data-scope="${scope}"] .io-coding-bar`), frame = pane.querySelector('.io-editor-frame');
        const select = bar.querySelector('select'), segment = bar.querySelector('.io-coding-seg');
        const title = frame.querySelector('.io-pane-title'), area = frame.querySelector('.io-area'), style = getComputedStyle(area);
        const tools = frame.querySelector('.io-pane-tools'), toolBounds = rect(tools);
        const a = rect(area), f = rect(frame), b = rect(bar), s = rect(select), g = rect(segment);
        return { frame: f, bar: b, select: s, segment: g, tools: toolBounds,
          bom: !!bar.querySelector('.io-coding-bom input'), slider: !!segment.querySelector('.m3-segment-thumb'),
          toolsWidth: [...tools.querySelectorAll('button')].reduce((sum, button) => sum + rect(button).width, 0),
          contentInset: a.x + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft), titleX: rect(title).x,
          viewCount: segment.querySelectorAll('button').length, viewValues: [...segment.querySelectorAll('button')].map(n => n.dataset.view),
          viewFits: [...segment.querySelectorAll('button')].every(n => { const r = rect(n); return r.x >= g.x - 1 && r.right <= g.right + 1; }),
          painted: api.inspect(area)?.applied && api.inspect(select)?.applied &&
            (api.inspect(segment)?.applied || api.inspect(segment)?.reason === 'pill'),
        };
      }),
    };
  });
}
try {
  const page = await context();
  await page.goto(new URL('#/op/chacha20Poly1305', base).href); await page.locator('#ioOut').waitFor();
  for (const theme of ['light', 'dark']) for (const width of [1440, 1366, 1024, 600, 390, 320]) {
    await page.setViewportSize({ width, height: 900 }); await page.evaluate(theme => window.__ebctfToggleTheme(theme), theme);
    const m = await measure(page); evidence.push({ theme, width, ...m });
    check(!m.overflow, `${theme}/${width}: workspace fits`);
    check(m.profile === 'apple-continuous-measured', 'All engines use the measured shared profile');
    check(m.settings === 2, 'Both coding groups are in the parameter panel');
    for (const [i, p] of m.panes.entries()) {
      check(p.bom && p.slider, `${theme}/${width}/${i}: shared slider and BOM in each group`);
      check(Math.abs(p.select.height - p.segment.height) < 1, `Charset/view control heights match (${p.select.height}/${p.segment.height})`);
      check(Math.abs(p.titleX - p.contentInset) < 1, 'Editor title and text share the content inset');
      check(JSON.stringify(p.viewValues) === JSON.stringify(['text','hex','base64','escaped']) && p.viewFits, 'Exactly four fully visible views');
      check(p.tools.width <= p.toolsWidth + 1 && p.tools.right <= p.frame.right, 'Editor toolbar never covers more than the tools need');
      check(p.painted, 'Editor/select use the shared curve; the view capsule keeps its rounded profile');
    }
    check(Math.abs(m.panes[0].frame.x - m.panes[1].frame.x) < 1 && Math.abs(m.panes[0].frame.right - m.panes[1].frame.right) < 1, 'Input/output frame edges align');
    if (shots && width === 1366) await page.screenshot({ path: join(shots, `alignment-${engine}-${theme}-desktop.png`) });
  }
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.locator('#btnTheme').hover();
  check(await page.locator('#btnTheme').evaluate(node => {
    const bounds = node.getBoundingClientRect(), css = getComputedStyle(node);
    return Math.abs(bounds.width - bounds.height) < 1 && css.borderRadius === '50%' && css.backgroundColor !== 'rgba(0, 0, 0, 0)';
  }), 'Theme hover background is a circle');
  // Both old draft representations migrate to a visible Hex view without changing bytes.
  for (const [view, text, order, expected] of [['bits','10000010','lsb','41'],['base32','IE======','msb','41']]) {
    const result = await page.locator('#ioIn').evaluate((node, [view,text,order]) => {
      node.value = text; const ctl = node.__ioCoding;
      ctl.setBitOrder(order, { emit: false }); ctl.setView(view, { emit: false });
      return { text: node.value, view: ctl.getState().view };
    }, [view,text,order]);
    check(result.text === expected && result.view === 'hex', `${view}: exact old-draft migration`);
  }
  await page.locator('.ci-edit-btn').click(); await page.locator('.ci-editor-wrap .cm-content').waitFor();
  await page.waitForTimeout(600);
  const editor = await page.evaluate(async () => {
    const api = (await import(new URL('src/ui/continuousCorners.js', document.baseURI).href)).setupContinuousCorners();
    const frame = document.querySelector('.ci-editor-wrap'), cm = frame.querySelector('.cm-editor');
    return { frame: api.inspect(frame)?.applied, cm: cm.hasAttribute('data-cc-content'), outline: api.inspect(frame)?.source?.outlineWidth };
  });
  check(editor.frame && editor.cm && editor.outline >= 2, `Code editor frame, content clip and focus outline unified: ${JSON.stringify(editor)}`);
  if (shots) await page.screenshot({ path: join(shots, `alignment-${engine}-code-editor.png`) });
  await page.locator('.ci-header-close').click(); await page.locator('.ci-dialog').waitFor({ state: 'detached' });
  await page.goto(new URL('#/op/base64', base).href);
  await page.locator('.io-coding-mount[data-scope="input"] [data-view="text"]').click();
  await page.locator('#dirSeg button').first().click();
  await page.locator('#ioIn').fill('hello');
  await page.locator('.io-actions > .primary').click();
  await page.waitForFunction(() => document.querySelector('#ioOut')?.value === 'aGVsbG8=');
  await page.locator('.io-chain').click();
  await page.waitForFunction(() => document.querySelector('#ioOut')?.value === 'YUdWc2JHOD0=');
  check(await page.locator('#ioIn').evaluate(node => node.value === 'aGVsbG8=') && await page.locator('.io-swap').count() === 0, 'Only chaining remains and it runs the next conversion');
  await page.goto(new URL('#/op/bacon', base).href);
  const imageTrigger = page.locator('.edu-img-open').first();
  const thumbnail = imageTrigger.locator('img');
  await thumbnail.scrollIntoViewIfNeeded();
  await page.waitForFunction(() => document.querySelector('.edu-img-open img')?.naturalWidth > 0);
  await imageTrigger.press('Enter');
  const lightbox = page.locator('.img-lightbox');
  await lightbox.waitFor();
  check(await lightbox.locator('img').getAttribute('src') === await thumbnail.getAttribute('src'), 'Education lightbox opens the original image');
  await page.keyboard.press('Escape'); await lightbox.waitFor({ state: 'detached' });
  check(await imageTrigger.evaluate(node => document.activeElement === node), 'Closing the lightbox restores keyboard focus');
  const mobile = await context(true);
  await mobile.goto(new URL('#/op/chacha20Poly1305', base).href); await mobile.locator('#ioOut').waitFor();
  const m = await measure(mobile);
  check(!m.overflow && m.panes.every(p => p.viewFits && p.select.height >= 44 && p.select.height === p.segment.height), '320px touch: four views and equal 44px controls');
  if (shots) await mobile.screenshot({ path: join(shots, `alignment-${engine}-mobile.png`) });
  check(errors.length === 0, `No page errors: ${errors.join(';')}`);
  console.log(JSON.stringify({ verdict: 'PASS', engine, checks, measuredLayouts: evidence.length, pageErrors: errors }));
} catch (error) { console.error(JSON.stringify(evidence.at(-1), null, 2)); throw error; }
finally { for (const ctx of contexts) await ctx.close(); await browser.close(); }
