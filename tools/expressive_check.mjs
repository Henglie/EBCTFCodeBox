import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
const option = (k, d) => process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d;
const base = option('--base-url', 'http://127.0.0.1:8180/'), engine = option('--browser', 'chromium'), channel = option('--channel', undefined), shots = option('--screenshots-dir', undefined);
assert(['localhost', '127.0.0.1'].includes(new URL(base).hostname));
const pw = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await pw[engine].launch({ headless: true, ...(channel ? { channel } : {}) });
const errors = [], measurements = [];
let checks = 0;
const check = (v, label) => { assert(v, label); checks++; };
const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, serviceWorkers: 'block' });
await ctx.addInitScript(() => localStorage.setItem('ebctf_locale', 'zh'));
await ctx.route(/^https?:\/\/(?:127\.0\.0\.1|localhost):8181\//, r => r.fulfill({ status: 503, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*', 'Cross-Origin-Resource-Policy': 'cross-origin' }, body: '{}' }));
const page = await ctx.newPage(); page.on('pageerror', e => errors.push(e.message));
const go = async (route, selector) => { await page.goto(new URL(`#/${route}`, base).href); await page.locator(selector).first().waitFor(); await page.waitForTimeout(400); };
async function capture() {
  for (const [route, selector] of [['home', '.home-studio'], ['op/chacha20Poly1305', '#ioOut'], ['all', '.allops-card'], ['recipe', '.recipe-bar']]) {
    await go(route, selector);
    for (const theme of ['light', 'dark']) for (const width of [1366, 390]) {
      await page.setViewportSize({ width, height: 900 }); await page.evaluate(v => window.__ebctfToggleTheme(v), theme); await page.waitForTimeout(400);
      await page.locator('#workspace').evaluate(n => { n.scrollTop = 0; });
      check(await page.locator('#workspace').evaluate(n => n.scrollWidth <= n.clientWidth + 1), `${route}/${theme}/${width}: bounded`);
      if (shots) await page.screenshot({ path: join(shots, `expressive-${option('--capture', 'after')}-${engine}-${route.replace('/', '-')}-${theme}-${width}.png`) });
    }
  }
}
try {
  if (process.argv.includes('--capture')) { await capture(); console.log(JSON.stringify({ verdict: 'PASS', engine, checks, capture: option('--capture'), pageErrors: errors })); }
  else {
    await go('op/rot13', '#ioIn');
    await page.locator('#ioIn').fill('uryyb'); await page.locator('.io-actions .primary').click();
    await page.waitForFunction(() => document.getElementById('ioOut').textContent === 'hello');
    check(await page.locator('.op-feedback').getAttribute('data-state') === 'success', 'real run succeeds');
    await page.locator('#ioIn').fill('jbeyq');
    check(await page.locator('#ioOut').textContent() === 'hello', 'editing retains the previous readable result');
    check(await page.locator('#ioOut').getAttribute('data-result-stale') === 'true', 'previous result is visibly marked stale');
    check(await page.locator('.op-feedback').getAttribute('data-state') === 'stale', 'stale state has a compact announcement');
    await page.reload(); await page.locator('.op-feedback[data-state="stale"]').waitFor();
    check(await page.locator('#ioOut').textContent() === 'hello' && await page.locator('#ioIn').textContent() === 'jbeyq', 'refresh preserves the old result and its explicit stale identity');
    await page.locator('.io-actions .primary').click(); await page.waitForFunction(() => document.getElementById('ioOut').textContent === 'world');
    check(await page.locator('#ioOut').getAttribute('data-result-stale') === null, 'new result clears its stale marker');
    const primary = page.locator('.io-actions .primary');
    const before = await primary.evaluate(n => ({ radius: getComputedStyle(n).borderRadius, transform: getComputedStyle(n).transform }));
    await primary.hover(); await page.mouse.down(); await page.waitForTimeout(120);
    check(await primary.evaluate((n, before) => getComputedStyle(n).borderRadius === before.radius && getComputedStyle(n).transform === before.transform, before), 'pressed capsule keeps its shape and position');
    await page.mouse.up();
    await primary.focus(); await page.keyboard.down('Space');
    check(await primary.getAttribute('data-m3-pressed') === 'true', 'keyboard press has the same state layer');
    await page.keyboard.up('Space'); check(await primary.getAttribute('data-m3-pressed') === null, 'release clears state');
    await page.evaluate(async () => {
      const { setMotionSpeed } = await import('./src/ui/motionPreferences.js');
      const { enterSurface, exitSurface } = await import('./src/ui/expressiveMotion.js');
      const surface = document.createElement('div'); surface.id = 'motion-fixture'; surface.style.cssText = 'position:fixed;width:100px;height:80px;top:100px;left:100px;background:red'; document.body.append(surface);
      window.surfaceMotionResults = [];
      for (const speed of [.75, 1, 1.25]) {
        setMotionSpeed(speed, false); enterSurface(surface);
        window.surfaceMotionResults.push({ speed, duration: surface.getAnimations()[0]?.effect.getTiming().duration });
      }
      setMotionSpeed(1, false);
      enterSurface(surface);
      await new Promise(resolve => setTimeout(resolve, 40));
      const before = Number(getComputedStyle(surface).opacity);
      exitSurface(surface, () => { surface.remove(); window.surfaceExited = true; });
      window.surfaceExitStart = { before, from: surface.getAnimations().at(-1).effect.getKeyframes()[0].opacity };
    });
    const surface = await page.evaluate(() => ({ speeds: surfaceMotionResults, reverse: surfaceExitStart }));
    check(surface.speeds.every(s => Math.abs(s.duration - 200 * s.speed) < 1), 'spatial motion respects all three existing pace settings');
    check(Math.abs(surface.reverse.before - Number(surface.reverse.from)) < .02, 'exit samples the interrupted opening frame without snapping');
    await page.waitForFunction(() => window.surfaceExited);
    check(await page.locator('#motion-fixture').count() === 0, 'completed exit removes its surface without a fixed timer');
    await page.evaluate(async () => {
      const { enterSurface } = await import('./src/ui/expressiveMotion.js');
      const n = document.createElement('div'); n.id = 'motion-reduced-fixture'; document.body.append(n); enterSurface(n);
      document.documentElement.classList.add('reduce-motion');
    });
    await page.waitForTimeout(20);
    check(await page.locator('#motion-reduced-fixture').evaluate(n => n.getAnimations().length === 0), 'enabling reduced motion stops in-flight animation');
    await page.evaluate(() => { document.getElementById('motion-reduced-fixture').remove(); document.documentElement.classList.remove('reduce-motion'); });
    await go('all', '.allops-card');
    const header = page.locator('.allops-section-head').first();
    const motion = await header.evaluate(n => { n.click(); return n.nextElementSibling.getAnimations().map(a => ({ state: a.playState, duration: a.effect.getTiming().duration })); });
    check(motion.some(a => a.state === 'running'), 'disclosure has a real intermediate animation');
    await header.click(); await page.waitForTimeout(260);
    check(await header.getAttribute('aria-expanded') === 'true' && await page.locator('.allops-grid').first().isVisible(), 'mid-flight reversal reaches the latest expanded state');
    for (let i = 0; i < 6; i++) await header.click(); await page.waitForTimeout(300);
    check(await header.getAttribute('aria-expanded') === 'true', 'rapid toggles never queue obsolete states');
    const search = page.locator('.allops-search-input');
    await search.evaluate(n => { n.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })); n.value = 'base64'; n.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true, data: 'base64' })); }); await page.waitForTimeout(100);
    check(await page.locator('.allops-card').count() > 100, 'IME composition does not filter early');
    await search.dispatchEvent('compositionend'); await page.waitForTimeout(300);
    check(await page.locator('.allops-card').count() < 100, 'composition commit applies the filter');
    await search.fill(''); await page.waitForTimeout(350);
    await page.evaluate(() => document.documentElement.classList.add('reduce-motion'));
    const firstHeader = page.locator('.allops-section-head').first(); await firstHeader.click();
    check(await page.locator('.allops-grid').first().evaluate(n => n.hidden && n.getAnimations().length === 0), 'reduced motion closes disclosure immediately');
    await firstHeader.click();
    check(await page.locator('.allops-grid').first().isVisible(), 'reduced motion remains usable');
    await page.evaluate(() => document.documentElement.classList.remove('reduce-motion'));
    check(await page.locator('.allops-grid').first().evaluate(n => !n.hasAttribute('inert')), 'reopening restores focusability after interruption');
    await go('op/chacha20Poly1305', '#ioOut');
    for (const theme of ['light', 'dark']) for (const width of [1366, 390, 320]) {
      await page.setViewportSize({ width, height: 900 }); await page.evaluate(v => window.__ebctfToggleTheme(v), theme); await page.waitForTimeout(250);
      check(await page.locator('#workspace').evaluate(n => n.scrollWidth <= n.clientWidth + 1), `${theme}/${width}: no horizontal overflow`);
      const m = await page.locator('.op-title').evaluate(n => ({ spacing: getComputedStyle(n).letterSpacing, font: parseFloat(getComputedStyle(n).fontSize) }));
      check(m.spacing === 'normal' || parseFloat(m.spacing) >= 0, 'CJK title has no negative tracking');
      measurements.push({ theme, width, ...m });
    }
    await page.setViewportSize({ width: 1366, height: 900 });
    for (const theme of ['light', 'dark']) {
      await page.evaluate(v => window.__ebctfToggleTheme(v), theme); await page.waitForTimeout(250);
      await page.locator('.io-actions .primary').evaluate(async node => {
        await Promise.all(node.getAnimations().filter(a => Number.isFinite(a.effect?.getComputedTiming().endTime)).map(a => a.finished.catch(() => {})));
      });
      const ratios = await page.evaluate(async () => {
        const api = (await import('./src/ui/continuousCorners.js')).setupContinuousCorners();
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
        const c = canvas.getContext('2d');
        const color = value => { c.clearRect(0, 0, 1, 1); c.fillStyle = value; c.fillRect(0, 0, 1, 1); return [...c.getImageData(0, 0, 1, 1).data]; };
        const blend = (f, b) => f.slice(0, 3).map((v, i) => v * f[3] / 255 + b[i] * (1 - f[3] / 255));
        const lum = rgb => rgb.map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [.2126,.7152,.0722][i], 0);
        return ['.op-config .param > label', '.op-desc', '.op-data .io-actions > .primary', '.ci-toggle-label', '.op-feedback'].map(selector => {
          const node = document.querySelector(selector), chain = []; for (let p = node; p; p = p.parentElement) chain.unshift(p);
          let bg = [255,255,255]; for (const p of chain) bg = blend(color(api.inspect(p)?.applied ? api.inspect(p).source.background : getComputedStyle(p).backgroundColor), bg);
          const fg = blend(color(getComputedStyle(node).color), bg), a = lum(fg), b = lum(bg);
          return { selector, ratio: (Math.max(a,b)+.05)/(Math.min(a,b)+.05), foreground: getComputedStyle(node).color, background: bg };
        });
      });
      check(ratios.every(r => r.ratio >= 4.5), `${theme}: changed text/surface contrast ${JSON.stringify(ratios)}`);
      measurements.push({ theme, ratios });
    }
    // Text-only 200% scaling: independent of the editor's existing font control.
    await page.addStyleTag({ content: '.op-desc,.param>label,.io-pane-title,.op-feedback,.ci-toggle-label{font-size:200%!important}' });
    await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(200);
    const scaled = await page.locator('#workspace').evaluate(n => ({ width: n.clientWidth, scroll: n.scrollWidth,
      offenders: [...n.querySelectorAll('*')].filter(e => (e.getBoundingClientRect().right > n.getBoundingClientRect().right + 1 || e.scrollWidth > e.clientWidth + 20) && e.getBoundingClientRect().width > 0).map(e => ({ tag: e.tagName, cls: e.className, text: e.textContent.slice(0, 35), width: e.getBoundingClientRect().width, scroll: e.scrollWidth, overflow: getComputedStyle(e).overflowX })) }));
    check(scaled.scroll <= scaled.width + 1, `200% text scales without horizontal workspace overflow: ${JSON.stringify(scaled)}`);
    check(errors.length === 0, `page errors: ${errors.join('; ')}`);
    await go('op/rot13', '#ioIn');
    await page.evaluate(() => { document.getElementById('ioOut').__opFeedback.set('running', { cancel() {} }); });
    check(await page.locator('.op-feedback').getAttribute('data-immediate') === 'true', 'short tasks do not immediately spin a loading glyph');
    await page.waitForTimeout(230);
    check(await page.locator('.op-feedback').getAttribute('data-immediate') === null, 'long tasks reveal waiting motion after 200ms');
    await page.evaluate(() => { document.documentElement.classList.add('reduce-motion'); });
    check(await page.locator('.op-feedback .msym').evaluate(n => getComputedStyle(n).animationName === 'none'), 'reduced motion preserves running text without a rotating glyph');
    await page.evaluate(() => { document.getElementById('ioOut').__opFeedback.set('idle'); document.documentElement.classList.remove('reduce-motion'); });
    const touch = await browser.newContext({ hasTouch: true, viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    await touch.addInitScript(() => localStorage.setItem('ebctf_locale', 'zh'));
    const mobile = await touch.newPage(); mobile.on('pageerror', e => errors.push(e.message));
    await mobile.goto(new URL('#/op/rot13', base).href); await mobile.locator('#ioIn').fill('uryyb');
    await mobile.locator('.io-actions .primary').tap(); await mobile.waitForFunction(() => document.getElementById('ioOut').textContent === 'hello');
    check(await mobile.locator('.io-actions .primary').evaluate(n => n.getBoundingClientRect().height >= 48 && !n.hasAttribute('data-m3-pressed')), 'touch activation keeps a 48px stable primary and no sticky pressed state');
    await touch.close();
    check(errors.length === 0, `final page errors: ${errors.join('; ')}`);
    console.log(JSON.stringify({ verdict: 'PASS', engine, checks, measurements, pageErrors: errors }));
  }
} finally { await browser.close(); }
