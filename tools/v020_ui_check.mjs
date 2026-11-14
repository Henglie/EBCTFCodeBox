import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { startLauncher, stopLauncher } from './launcher_test_helpers.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const args = process.argv.slice(2);
const option = name => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
const section = option('--section') || 'fields';
const report = { section, checks: 0, stdout: '', stderr: '', cases: [] };
const { child, port } = await startLauncher(resolve('Windows点我启动.exe'), resolve('.'), report);
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1366, height: 900 } });
await context.route(/^https?:\/\/(127\.0\.0\.1|localhost):8181\//, r => r.fulfill({ status: 503, body: '{}' }));
await context.addInitScript(() => localStorage.setItem('ebctf_locale', 'zh'));
const page = await context.newPage();
page.setDefaultTimeout(5000);
const check = (v, label) => { assert.ok(v, label); report.checks++; };
try {
  if (section === 'fields') {
    for (const id of ['aes', 'chacha20Poly1305', 'pbkdf2']) {
      await page.goto(`http://127.0.0.1:${port}/#/op/${id}`, { waitUntil: 'domcontentloaded' });
      await page.locator('.op-config .secret-field').first().waitFor();
      for (const layout of ['traditional', 'adaptive']) for (const width of [1366, 860, 390, 320]) {
        await page.setViewportSize({ width, height: 900 });
        await page.evaluate(async value => (await import('/src/ui/layoutPreferences.js')).setOpLayout(value), layout);
        await page.waitForTimeout(90);
        const fields = await page.locator('.op-config .secret-field').evaluateAll(nodes => nodes.map(n => {
          const shell = n.getBoundingClientRect();
          const input = n.querySelector('input:not([type=file]),textarea').getBoundingClientRect();
          const actions = [...n.querySelectorAll('.exp-btn,.secret-eye-btn')].map(b => {
            const r = b.getBoundingClientRect(); return r.left >= shell.left && r.right <= shell.right + 1;
          });
          return { shell: shell.width, input: input.width, actions };
        }));
        report.cases.push({ id, layout, width, fields });
        check(fields.length > 0 && fields.every(f => f.shell >= 180 && f.input >= 80), `usable fields: ${JSON.stringify(report.cases.at(-1))}`);
        check(fields.every(f => f.actions.every(Boolean)), `actions within shell ${id}/${layout}/${width}`);
        check(await page.locator('#workspace').evaluate(n => n.scrollWidth <= n.clientWidth + 1), `no overflow ${id}/${width}`);
      }
    }
  } else if (section === 'integration') {
    await context.route('**/license.bin', route => route.fulfill({ status: 404, body: '' }));
    await page.goto(`http://127.0.0.1:${port}/#/about`, { waitUntil: 'domcontentloaded' });
    await page.locator('.about-title').waitFor();
    const locales = ['zh', 'en', 'es', 'fr', 'de', 'ja', 'ko', 'ru', 'pt', 'hi', 'id', 'tr', 'ar', 'he', 'fa', 'ur', 'bo', 'ug', 'za-Latn', 'mn-Mong'];
    const localName = new Set(['zh', 'ja', 'ko', 'bo', 'ug', 'za-Latn', 'mn-Mong']);
    const quotation = new Set(['zh', 'bo', 'ug', 'za-Latn', 'mn-Mong']);
    for (const locale of locales) {
      await page.evaluate(async value => (await import('/src/i18n/index.js')).setLocale(value), locale);
      const name = localName.has(locale) ? '码小妹' : 'EBCrypto';
      await page.locator('.about-title').filter({ hasText: name }).waitFor();
      check(await page.locator('.about-title').textContent() === name, `brand ${locale}`);
      check(await page.locator('.about-local-quote').count() === Number(quotation.has(locale)), `quote locale ${locale}`);
      const manifest = await page.evaluate(async () => (await fetch(document.querySelector('link[rel=manifest]').href)).json());
      check(manifest.name === name && manifest.id.startsWith('http://127.0.0.1:'), `manifest name/id ${locale}`);
    }
    await page.evaluate(async () => (await import('/src/i18n/index.js')).setLocale('zh'));
    await page.evaluate(() => { location.hash = '#/tools'; });
    await page.locator('.local-tools-page .lt-card').first().waitFor();
    check(await page.locator('.lt-card').count() === 48, 'actual tools route and full catalog');
    check(await page.locator('.local-tools-page h1').textContent() === '本机环境工具管理', 'tools translated heading');
    await page.evaluate(() => { location.hash = '#/about'; });
    await page.locator('.about-title').waitFor();
    check(await page.locator('.local-tools-page').count() === 0, 'tools route disposes on exit');
    await context.unroute('**/license.bin');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('.about-license-pill.is-verified').waitFor();
    const labels = await page.locator('.about-license-status').allTextContents();
    check(labels.includes('授权给') && labels.includes('来源自') && labels.includes('授权日期'), 'literal license labels in actual about page');
    check(await page.locator('a[href="public/license-verifier/index.html"]').count() === 1, 'offline verifier entry connected');
  } else if (section === 'strength') {
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded' });
    await page.locator('.magic-strength-btn').click();
    await page.locator('.ds-list').waitFor();
    await page.locator('.ds-prof-name').fill('v020-theme');
    await page.locator('.ds-sec-prof .ds-mini').filter({ hasText: /^保存$/ }).click();
    await page.locator('.ds-sec-prof .m3-select-trigger').click();
    await page.locator('.ds-sec-prof .m3-select-menu').waitFor();
    check(await page.locator('.ds-sec-prof .m3-select-menu [role=option]').count() === 1, 'profile uses themed options');
    await page.keyboard.press('Escape');
    check(await page.locator('.ds-dialog').count() === 1, 'select Escape does not close strength');
    for (const [width, height] of [[1366, 900], [390, 600], [320, 360]]) for (const scope of ['text', 'file']) {
      await page.setViewportSize({ width, height });
      await page.locator(`.ds-tabs button[data-scope=${scope}]`).click();
      await page.waitForTimeout(80);
      const sizes = await page.evaluate(() => {
        const body = document.querySelector('.ds-body'), list = document.querySelector('.ds-list'), foot = document.querySelector('.ds-foot').getBoundingClientRect();
        return { overflow: getComputedStyle(body).overflowY, list: list.clientHeight,
          scroll: body.scrollHeight > body.clientHeight, bottom: foot.bottom, viewport: innerHeight };
      });
      check(sizes.overflow === 'scroll' && sizes.scroll, `body scroll ${width}/${scope}: ${JSON.stringify(sizes)}`);
      check(sizes.list >= 240, 'algorithm viewport does not collapse');
      check(sizes.bottom <= sizes.viewport, 'footer remains reachable');
      await page.locator('.ds-list .ds-cat-head').last().click();
      const last = page.locator('.ds-list .ds-op-row').last();
      await last.scrollIntoViewIfNeeded();
      check(await last.evaluate(n => { const a = n.getBoundingClientRect(), foot = document.querySelector('.ds-foot').getBoundingClientRect(); return a.top >= 0 && a.bottom <= foot.top + 1; }), 'last algorithm reachable');
      report.cases.push({ width, height, scope, sizes });
    }
    await page.locator('.ds-close').click();
  } else if (section === 'editor') {
    let slow = true;
    await context.route('**/codemirror.bundle.js*', async route => {
      if (slow) { slow = false; await new Promise(done => setTimeout(done, 700)); }
      await route.continue();
    });
    await page.goto(`http://127.0.0.1:${port}/#/op/rot13`, { waitUntil: 'domcontentloaded' });
    await page.locator('.ci-edit-btn').click();
    await page.locator('.ci-loading-mask').waitFor();
    check(await page.locator('.ci-loading-mask progress:not([value])').count() === 1, 'indeterminate cold loading');
    await page.locator('.ci-loading-mask button').click();
    check(await page.locator('.ci-loading-mask').count() === 0, 'cancel removes cold loader');
    await page.locator('.ci-edit-btn').click();
    await page.locator('.ci-dialog .cm-content').first().waitFor();
    check(await page.locator('.ci-dialog').count() === 1, 'cancel/reopen cannot create duplicate editor');
    await page.locator('.ci-loading-stage').waitFor({ state: 'hidden' });
    check(await page.locator('.ci-header-close').count() === 1, 'one header close');
    check(await page.locator('.ci-foot button').filter({ hasText: /^关闭$/ }).count() === 0, 'no redundant footer close');
    for (const theme of ['light', 'dark']) {
      await page.evaluate(value => window.__ebctfToggleTheme(value), theme);
      await page.locator('.ci-head .m3-select-trigger').click();
      const menu = page.locator('.ci-head .m3-select-menu');
      await menu.waitFor();
      check(await menu.evaluate(n => {
        const paint = window.__EBCTFContinuousCorners?.setupContinuousCorners().inspect(n)?.source;
        const background = paint?.background || getComputedStyle(n).backgroundColor;
        return background !== 'rgb(255, 255, 255)' && background !== 'rgba(0, 0, 0, 0)';
      }), `themed popup ${theme}`);
      await page.keyboard.press('ArrowDown');
      check(await menu.locator('[role=option]:focus').count() === 1, 'keyboard option focus');
      await page.keyboard.press('Escape');
      check(await page.locator('.ci-dialog').count() === 1, 'select Escape preserves editor');
    }
    for (const [width, height] of [[1366, 768], [390, 600], [320, 360]]) {
      await page.setViewportSize({ width, height });
      await page.locator('.ci-tools-toggle').click();
      await page.waitForTimeout(100);
      const geometry = await page.locator('.ci-panel').evaluate(n => {
        const r = n.getBoundingClientRect(), d = n.closest('.ci-dialog').getBoundingClientRect();
        return { top: r.top, bottom: r.bottom, left: r.left, right: r.right,
          dialogTop: d.top, dialogBottom: d.bottom, height: n.clientHeight, full: n.scrollHeight };
      });
      check(geometry.top >= geometry.dialogTop && geometry.bottom <= geometry.dialogBottom && geometry.height >= 80, `drawer inside ${width}/${height}: ${JSON.stringify(geometry)}`);
      const last = page.locator('.ci-panel .ci-psec.grow .ci-chip').last();
      await last.scrollIntoViewIfNeeded();
      check(await last.evaluate(n => { const a = n.getBoundingClientRect(), b = n.closest('.ci-panel').getBoundingClientRect(); return a.top >= b.top - 1 && a.bottom <= b.bottom + 1; }), `last helper reachable ${width}`);
      await page.keyboard.press('Escape');
      check(await page.locator('.ci-dialog').count() === 1 && await page.locator('.ci-tools-toggle').getAttribute('aria-expanded') === 'false', 'Escape collapses drawer before editor');
    }
    await page.locator('.ci-header-close').click();
    await context.unroute('**/codemirror.bundle.js*');
    let fail = true;
    await context.route('**/codemirror.bundle.js*', async route => {
      if (fail) { fail = false; await route.abort(); } else await route.continue();
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('.ci-edit-btn').click();
    await page.locator('.ci-loading-card').getByRole('button', { name: '重试', exact: true }).waitFor();
    check(await page.locator('.ci-loading-card').textContent().then(t => t.includes('加载失败')), 'module error is visible');
    await page.locator('.ci-loading-card').getByRole('button', { name: '重试', exact: true }).click();
    await page.locator('.ci-dialog .cm-content').first().waitFor();
    await page.locator('.ci-loading-stage').waitFor({ state: 'hidden' });
    check(await page.locator('.ci-dialog').count() === 1, 'retry with a fresh module URL works');
    await page.locator('.ci-header-close').click();
  }
} finally { await context.close(); await browser.close(); await stopLauncher(child); }
if (option('--out')) await writeFile(resolve(option('--out')), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ section, checks: report.checks, cases: report.cases.length, result: 'PASS' }));
