import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const option = (key, fallback) => process.argv.includes(key) ? process.argv[process.argv.indexOf(key) + 1] : fallback;
const pw = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = option('--base-url', 'http://127.0.0.1:8180/');
const engine = option('--browser', 'chromium'), channel = option('--channel', undefined), shots = option('--screenshots-dir', undefined);
assert(['localhost', '127.0.0.1'].includes(new URL(base).hostname));
const browser = await pw[engine].launch({ headless: true, ...(channel ? { channel } : {}) });
const errors = [], evidence = [];
let checks = 0;
const check = (value, label) => { assert(value, label); checks++; };
const context = await browser.newContext({ viewport: { width: 1366, height: 900 }, serviceWorkers: 'block', hasTouch: true });
await context.addInitScript(() => localStorage.setItem('ebctf_locale', 'zh'));
await context.route(/^https?:\/\/(?:127\.0\.0\.1|localhost):8181\//, route => route.fulfill({ status: 503, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*', 'Cross-Origin-Resource-Policy': 'cross-origin' }, body: '{"error":"bridge unavailable in frontend test"}' }));
const page = await context.newPage();
page.on('pageerror', error => errors.push(error.message));
const settle = () => page.waitForTimeout(450);
const go = async (route, selector) => {
  await page.goto(new URL(`#/${route}`, base).href);
  await page.locator(selector).first().waitFor(); await settle();
};
const shot = async name => { if (shots) await page.screenshot({ path: join(shots, `surfaces-${engine}-${name}.png`) }); };
async function paint(selector) {
  const node = page.locator(selector).first();
  await node.scrollIntoViewIfNeeded(); await settle();
  const result = await node.evaluate(async node => {
    const api = (await import(new URL('src/ui/continuousCorners.js', document.baseURI).href)).setupContinuousCorners();
    const r = node.getBoundingClientRect(), state = api.inspect(node);
    return { applied: state?.applied, reason: state?.reason, profile: api.stats().profile,
      x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height,
      fits: node.scrollWidth <= node.clientWidth + 1 };
  });
  evidence.push({ selector, ...result });
  check((result.applied || result.reason === 'pill' || result.reason === 'circle') && result.profile === 'apple-continuous-measured', `${selector}: shared curve or preserved M3 capsule/circle ${JSON.stringify(result)}`);
  return result;
}
async function openEnvironment() {
  if (await page.locator('#btnMoreActions').isVisible() && !await page.locator('#btnFont').isVisible()) await page.locator('#btnMoreActions').click();
  await page.locator('#btnFont').click(); await page.locator('.env-panel').waitFor(); await settle();
}
async function closeEnvironment() {
  await page.locator('#envMotionSpeed').focus(); await page.keyboard.press('Escape');
  await page.locator('.env-panel').waitFor({ state: 'detached' });
  check(await page.locator('#btnFont').evaluate(n => n === document.activeElement), 'Environment Escape restores its launcher');
  if (await page.locator('#btnMoreActions').isVisible()) await page.keyboard.press('Escape');
}
try {
  await go('op/chacha20Poly1305', '#ioOut');
  for (const theme of ['light', 'dark']) for (const [width, height] of [[1366, 900], [390, 844], [320, 568], [900, 400]]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(theme => window.__ebctfToggleTheme(theme), theme);
    await openEnvironment();
    const m = await page.locator('.env-panel').evaluate(node => {
      const rect = n => { const r = n.getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; };
      const sections = [...node.querySelectorAll('.env-section')].map(section => {
        const r = rect(section), title = section.querySelector('.env-section-title'), style = getComputedStyle(section);
        return { ...r, title: rect(title), inset: parseFloat(style.paddingInlineStart), overflow: section.scrollWidth > section.clientWidth + 1 };
      });
      const headings = [...node.querySelectorAll('.env-section-title')].map(n => rect(n).height);
      return { panel: rect(node), width: innerWidth, height: innerHeight, sections, headings, overflow: node.scrollWidth > node.clientWidth + 1,
        actionHeights: [...node.querySelectorAll('.env-clear-io, .env-reset-btn, #envMotionSpeed')].map(n => rect(n).height) };
    });
    evidence.push({ theme, width, height, ...m });
    check(m.panel.x >= 7 && m.panel.right <= width - 7 && m.panel.y >= 0 && m.panel.bottom <= height - 7, `Environment stays inside ${width}x${height}: ${JSON.stringify(m.panel)}`);
    check(!m.overflow && m.sections.every(s => !s.overflow), 'Environment text and settings fit horizontally');
    check(m.sections.every(s => s.inset === 12 && Math.abs(s.title.x - s.x - 12) < 1), 'Section headings share a 12px content inset');
    check(m.headings.every(h => Math.abs(h - m.headings[0]) < 1), 'Icon and text-only section headings share a line height');
    check(m.actionHeights.every(h => h >= 44), 'Settings and bottom actions share 44px minimum height');
    await paint('.env-panel'); await paint('.env-theme-box');
    await page.locator('.env-panel').evaluate(n => { n.scrollTop = 0; }); await settle();
    await shot(`environment-${theme}-${width}x${height}`);
    await page.locator('.env-reset-btn').focus(); await page.locator('.env-reset-btn').press('Enter'); await page.locator('.env-reset-dialog').waitFor();
    const reset = await paint('.env-reset-dialog');
    check(reset.x >= 0 && reset.right <= width && reset.y >= 0 && reset.bottom <= height, 'Reset confirmation fits without invoking reset');
    await page.keyboard.press('Escape'); await page.locator('.env-reset-mask').waitFor({ state: 'detached' });
    check(await page.locator('.env-reset-btn').evaluate(n => n === document.activeElement), 'Reset cancellation returns focus');
    await closeEnvironment();
  }
  // Reposition an already-open panel; opening-only sizing misses rotation/resize.
  await page.setViewportSize({ width: 1366, height: 900 }); await openEnvironment();
  await page.setViewportSize({ width: 900, height: 350 }); await settle();
  check(await page.locator('.env-panel').evaluate(n => n.getBoundingClientRect().bottom <= innerHeight - 7), 'Open environment resizes with the viewport');
  await closeEnvironment();

  for (const [width, height] of [[1366, 900], [320, 568], [900, 300]]) {
    await page.setViewportSize({ width, height }); await settle();
    const launcher = page.locator('.exp-btn').first(); await launcher.focus(); await launcher.press('Enter'); await page.locator('.exp-textarea').waitFor(); await settle();
    const dialog = await paint('.exp-dialog'), area = await paint('.exp-textarea');
    check(dialog.x >= 0 && dialog.right <= width && dialog.y >= 0 && dialog.bottom <= height, 'Expanded editor fits its viewport');
    const m = await page.locator('.exp-dialog').evaluate(n => {
      const head = n.querySelector('.exp-head').getBoundingClientRect(), area = n.querySelector('textarea').getBoundingClientRect(), foot = n.querySelector('.exp-foot').getBoundingClientRect();
      return { inset: Math.abs(head.x - area.x), right: Math.abs(foot.right - area.right), topGap: area.y - head.bottom, bottomGap: foot.y - area.bottom,
        actions: [...n.querySelectorAll('.exp-action')].map(n => n.getBoundingClientRect().height), name: n.querySelector('textarea').getAttribute('aria-label') };
    });
    check(m.inset < 1 && m.right < 1 && Math.abs(m.topGap - 16) < 1 && Math.abs(m.bottomGap - 16) < 1, `Expanded title/editor/footer align: ${JSON.stringify(m)}`);
    check(m.actions.every(h => h >= 44) && m.name, 'Expanded actions and editor name are accessible');
    await shot(`expanded-${width}x${height}`);
    await page.keyboard.press('Escape'); await page.locator('.exp-dialog').waitFor({ state: 'detached' });
    check(await launcher.evaluate(n => n === document.activeElement), 'Expanded editor restores focus');
  }
  await page.setViewportSize({ width: 1366, height: 900 });
  for (const [route, selectors] of [
    ['home', ['.home-studio', '.home-input', '.home-tool-card']],
    ['all', ['.allops-section', '.allops-card', '.allops-search']],
    ['recipe', ['.recipe-bar', '.recipe-bake-btn']],
    ['codeimg', ['.ci-card']],
    ['quickconv', ['.qc-input', '.qc-chip:not(.qc-chip-round)']],
  ]) {
    await go(route, selectors[0]);
    for (const theme of ['light', 'dark']) for (const width of [1366, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(theme => window.__ebctfToggleTheme(theme), theme); await settle();
      for (const selector of selectors) await paint(selector);
      check(await page.locator('#workspace').evaluate(n => n.scrollWidth <= n.clientWidth + 1), `${route}/${theme}/${width}: page fits`);
      await shot(`${route}-${theme}-${width}`);
    }
  }
  await page.setViewportSize({ width: 1366, height: 900 });
  await go('op/rsaModinv', '.family-more');
  await page.locator('.family-more').click(); await page.locator('.family-overflow-menu').waitFor();
  await paint('.family-overflow-menu'); await paint('.family-overflow-choice');
  await page.keyboard.press('Escape'); await page.locator('.family-overflow-menu').waitFor({ state: 'detached' });
  check(await page.locator('.family-more').evaluate(n => n === document.activeElement), 'Family menu Escape restores focus');
  await go('op/base64', '#ioIn');
  await page.locator('.io-tools-more > summary').first().click();
  await paint('.io-tools-extra'); await shot('tools-menu');
  await page.locator('.io-tools-more > summary').first().click();
  const select = await paint('.io-coding-bar select');
  check(select.height >= 44, 'Native select shell retains touch geometry');
  await page.locator('.io-coding-bar select').first().selectOption('utf-8');
  check(await page.locator('.io-coding-bar select').first().inputValue() === 'utf-8', 'Browser-owned select options still work');
  await page.locator('#ioIn').fill('surfaces'); await page.locator('#dirSeg button').first().click();
  await page.locator('.io-actions .primary').click(); await page.waitForFunction(() => document.getElementById('ioOut').textContent === 'c3VyZmFjZXM=');
  const footer = await page.locator('.io-report-footer').evaluate(n => {
    const a = n.querySelector('.op-feedback').getBoundingClientRect(), b = n.querySelector('.io-report').getBoundingClientRect();
    return { center: Math.abs(a.y + a.height / 2 - b.y - b.height / 2), state: n.querySelector('.op-feedback').dataset.state };
  });
  check(footer.center < 1 && footer.state === 'success', 'Report and feedback centerlines align after real conversion');
  check(errors.length === 0, `No page errors: ${errors.join('; ')}`);
  console.log(JSON.stringify({ verdict: 'PASS', engine, checks, pageErrors: errors, nativeBoundary: 'select option popup remains browser/OS-owned', ...(process.argv.includes('--json') ? { evidence } : {}) }));
} catch (error) { console.error(JSON.stringify(evidence.at(-1), null, 2)); throw error; }
finally { await browser.close(); }
