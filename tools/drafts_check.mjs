import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
const option = (name, fallback) => { const index = process.argv.indexOf(name); return index < 0 ? fallback : process.argv[index + 1]; };
const base = option('--base-url', 'http://127.0.0.1:8180/');
assert(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(base).hostname));
const engine = option('--browser', 'chromium'), channel = option('--channel', undefined);
const shots = option('--screenshots-dir', undefined);
const require = createRequire(import.meta.url), pw = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await pw[engine].launch({ headless: true, ...(channel ? { channel } : {}) });
let checks = 0;
const check = (value, label) => { assert(value, label); checks++; };
const errors = [];
try {
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 }, locale: 'zh-CN', serviceWorkers: 'block' });
  // This suite verifies frontend drafts, independent of a machine's optional bridge.
  const bridgeUnavailable = route => route.fulfill({ status: 503, contentType: 'application/json',
    headers: { 'Access-Control-Allow-Origin': '*', 'Cross-Origin-Resource-Policy': 'cross-origin' }, body: '{"error":"bridge unavailable in frontend test"}' });
  await context.route(/^https?:\/\/(?:127\.0\.0\.1|localhost):8181\//, bridgeUnavailable);
  await context.addInitScript(() => localStorage.setItem('ebctf_locale', 'zh'));
  if (process.argv.includes('--trace-journal')) await context.addInitScript(() => {
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'ebctf.workspaceDraft.exhaust') console.log('DRAFT_TRACE ' + JSON.stringify({ hash: location.hash, time: Date.now(), record: JSON.parse(value) }));
      return set.call(this, key, value);
    };
  });
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.text().startsWith('DRAFT_TRACE ')) console.log(message.text()); });
  const go = async (route, selector = '#ioOut') => {
    await page.goto(new URL(`#/${route}`, base).href);
    if (route.startsWith('op/')) await page.locator(`#ci_enable_${route.slice(3)}`).waitFor({ state: 'attached' });
    await page.locator(selector).first().waitFor(); await page.waitForTimeout(100);
  };
  const value = selector => page.locator(selector).evaluate(node => node.value ?? node.textContent);
  const diagnose = async (label, force = false) => {
    if (!force && !process.argv.includes('--diagnostics')) return;
    console.log(JSON.stringify({ label, data: await page.evaluate(async () => {
      const request = indexedDB.open('ebctf-workspace-drafts', 1);
      const db = await new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = reject; });
      const get = db.transaction('drafts').objectStore('drafts').get('exhaust');
      const saved = await new Promise(resolve => { get.onsuccess = () => resolve(get.result); get.onerror = () => resolve(null); }); db.close();
      return { hash: location.hash, input: document.querySelector('.exhaust-input')?.textContent,
        saved, journal: localStorage.getItem('ebctf.workspaceDraft.exhaust') };
    }) }));
  };
  const convert = () => page.locator('.io-actions .primary').click();
  await go('op/base64');
  for (const [width, height] of [[1366, 768], [1440, 900], [1024, 768]]) {
    await page.setViewportSize({ width, height }); await page.waitForTimeout(200);
    const geometry = await page.evaluate(() => {
      const ws = document.querySelector('#workspace').getBoundingClientRect();
      const wb = document.querySelector('.op-workbench'), config = document.querySelector('.op-config').getBoundingClientRect(), data = document.querySelector('.op-data').getBoundingClientRect();
      const frames = [...document.querySelectorAll('.io-editor-frame')].map(node => { const r = node.getBoundingClientRect(); return { top: r.top, bottom: r.bottom }; });
      return { layout: wb.dataset.layout, equal: Math.abs(config.width - data.width), frames, ws: { top: ws.top, bottom: ws.bottom },
        title: parseFloat(getComputedStyle(document.querySelector('.op-title')).fontSize), desc: getComputedStyle(document.querySelector('.op-desc')).textAlign,
        directionWidth: document.querySelector('#dirSeg').getBoundingClientRect().width, configWidth: config.width,
        overflow: document.querySelector('#workspace').scrollWidth > document.querySelector('#workspace').clientWidth + 1 };
    });
    check(geometry.layout === 'split' && geometry.equal < 2, `Landscape equal split ${width}: ${JSON.stringify(geometry)}`);
    check(geometry.frames.length === 2 && geometry.frames.every(frame => frame.top >= geometry.ws.top && frame.bottom <= geometry.ws.bottom), `Both complete editors visible at ${width}x${height}: ${JSON.stringify(geometry)}`);
    check(geometry.title >= 28 && ['start', 'left'].includes(geometry.desc), 'Larger title and left-aligned description');
    check(geometry.directionWidth < geometry.configWidth - 20 && !geometry.overflow, 'Natural-width direction control and bounded workspace');
    if (shots) await page.screenshot({ path: join(shots, `drafts-${engine}-${width}x${height}.png`) });
  }
  await page.setViewportSize({ width: 1024, height: 1366 });
  await page.locator('.op-workbench[data-layout="stack"]').waitFor(); check(true, 'Large portrait uses the stacked layout');
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.locator('#dirSeg button').first().click();
  await page.locator('#ioIn').fill('draft round trip'); await convert();
  await page.waitForFunction(() => document.getElementById('ioOut')?.value === 'ZHJhZnQgcm91bmQgdHJpcA==');
  await go('op/freqDist'); await page.locator('#ioIn').fill('aab'); await convert();
  await page.waitForFunction(() => document.getElementById('ioOut')?.value.includes('66.67%'));
  await go('op/base64');
  check(await value('#ioIn') === 'draft round trip', 'Switching algorithms retains each input independently');
  check(await value('#ioOut') === 'ZHJhZnQgcm91bmQgdHJpcA==', 'Previous output is restored without recomputation');
  await page.locator('#ioIn').fill('immediate');
  await page.locator('#ioIn').press('End'); await page.locator('#ioIn').press('Enter'); await page.keyboard.type('reload');
  check(await value('#ioIn') === 'immediate\nreload', 'Real keyboard creates the expected two-line input before refresh');
  await page.reload();
  await page.locator('#ci_enable_base64').waitFor({ state: 'attached' });
  check(await value('#ioIn') === 'immediate\nreload', `Immediate reload retains the final edit and literal newline: ${JSON.stringify(await value('#ioIn'))}`);
  await convert();
  await page.waitForFunction(() => document.getElementById('ioOut')?.value === 'aW1tZWRpYXRlCnJlbG9hZA==');
  check(true, 'Direction and encoding state survive refresh and remain usable');
  await go('op/rsaCrt');
  await page.locator('#fld_residues').fill('2, 3, 2'); await page.locator('#fld_moduli').fill('3, 5, 7'); await convert();
  await page.waitForFunction(() => /x = 23/.test(document.getElementById('ioOut')?.value || ''));
  await go('about', '.about-page'); await page.reload(); await page.locator('.about-page').waitFor();
  await go('op/rsaCrt');
  check(await value('#fld_residues') === '2, 3, 2' && await value('#fld_moduli') === '3, 5, 7', 'Both fields survive route changes and refresh');
  check(/x = 23/.test(await value('#ioOut')), 'Multi-field output survives refresh');
  await go('op/pcapParse');
  const bytes = Buffer.from('d4c3b2a1020004000000000000000000ffff000001000000', 'hex');
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.locator('.io-pane-input').getByRole('button', { name: '选择文件', exact: true }).click()]);
  await chooser.setFiles({ name: 'draft.pcap', mimeType: 'application/vnd.tcpdump.pcap', buffer: bytes });
  await page.waitForFunction(() => document.getElementById('ioIn')?._rawBytes?.length === 24);
  // Wait for the IndexedDB transaction to commit, not for a fixed async predicate.
  await page.waitForTimeout(300);
  await page.reload(); await page.locator('#ci_enable_pcapParse').waitFor({ state: 'attached' });
  check(await page.locator('#ioIn').evaluate(node => node._rawBytes?.length === 24 && node._rawFileName === 'draft.pcap'), 'File bytes and filename survive refresh');
  await convert(); await page.waitForFunction(() => /pcap/i.test(document.getElementById('ioOut')?.value || ''));
  check(!await page.locator('#ioOut').evaluate(node => node.classList.contains('error')), 'Restored file still executes through the real byte channel');
  for (const [route, selector, text] of [['exhaust', '.exhaust-input', 'exhaust draft'], ['inspect', '.uv-input', '41 42']]) {
    await go(route, selector); await page.locator(selector).fill(text); await diagnose('filled'); await go('about', '.about-page');
    await diagnose('left'); await page.reload(); await diagnose('reloaded'); await go(route, selector); await diagnose('returned');
    if (await value(selector) !== text) await diagnose('failed-restore', true);
    check(await value(selector) === text, `${route} input survives navigation and refresh: ${JSON.stringify(await value(selector))}`);
  }
  await go('home', '.home-input'); await page.locator('.home-input').fill('ZmxhZ3tkcmFmdH0=');
  await page.reload(); await page.locator('.home-input').waitFor();
  check(await value('.home-input') === 'ZmxhZ3tkcmFmdH0=', 'Home input survives refresh');
  await go('quickconv', '.qc-input'); await page.locator('.qc-input').first().fill('101');
  const number = await page.locator('.qc-input').first().inputValue();
  await go('about', '.about-page'); await page.reload(); await go('quickconv', '.qc-input');
  check(await page.locator('.qc-input').first().inputValue() === number, 'Quick conversion values survive refresh');
  await go('op/qrGen'); await page.locator('#ioIn').fill('persisted-qr'); await convert();
  await page.waitForFunction(() => document.querySelector('#ioOutMedia img')?.naturalWidth > 0);
  await page.reload(); await page.locator('#ci_enable_qrGen').waitFor({ state: 'attached' });
  await page.waitForFunction(() => document.querySelector('#ioOutMedia img')?.naturalWidth > 0);
  check(await value('#ioIn') === 'persisted-qr', 'Image result and source input survive refresh');
  await go('op/rsaEgcd'); await page.locator('#p_a').fill('30'); await page.locator('#p_b').fill('18');
  await go('about', '.about-page');
  await page.evaluate(async () => {
    localStorage.setItem('ebctf.draftTest.keep', 'preserved');
    const { saveDraft, serializeRecipe } = await import('./src/ui/recipeStore.js');
    saveDraft(serializeRecipe({ nodes: [{ opId: 'base64', dir: 'encode', params: {} }], input: 'recipe input', inputKind: 'text' }));
  });
  const second = await context.newPage();
  await second.goto(new URL('#/op/base64', base).href); await second.locator('#ci_enable_base64').waitFor({ state: 'attached' });
  check((await second.locator('#ioIn').evaluate(node => node.value)).length > 0, 'Second tab starts with a real persisted draft');
  await page.locator('#btnFont').click(); await page.locator('.env-clear-io').waitFor();
  check(await page.locator('.env-clear-io-box').evaluate(node => !!(node.compareDocumentPosition(document.querySelector('.env-reset-box')) & Node.DOCUMENT_POSITION_FOLLOWING)), 'Clear input/output is above full reset');
  await page.locator('.env-clear-io').click(); await page.waitForFunction(() => !document.querySelector('.env-clear-io')?.disabled);
  check(await page.evaluate(() => localStorage.getItem('ebctf.draftTest.keep')) === 'preserved', 'IO-only clear keeps unrelated settings');
  check(await page.evaluate(async () => { const { loadDraft } = await import('./src/ui/recipeStore.js'); const draft = loadDraft(); return draft.nodes.length === 1 && draft.input === ''; }), 'IO clear preserves a recipe that has not been opened this session');
  await second.waitForFunction(() => document.getElementById('ioIn')?.value === '');
  check(true, 'Clearing drafts also clears an already-open second tab'); await second.close();
  await page.keyboard.press('Escape');
  for (const id of ['base64', 'freqDist', 'rsaCrt', 'pcapParse']) {
    await go(`op/${id}`);
    check(await page.locator('.io-area').evaluateAll(nodes => nodes.every(node => (node.value || '') === '' && !node._rawBytes)), `${id}: all cached fields/output/file bytes cleared`);
  }
  await page.reload(); await page.locator('#ci_enable_pcapParse').waitFor({ state: 'attached' });
  check(await value('#ioIn') === '' && await value('#ioOut') === '', 'Cleared data cannot return after refresh');
  await go('op/rsaEgcd'); check(await value('#p_a') === '30' && await value('#p_b') === '18', 'IO-only clear retains algorithm parameters');
  for (const [route, selector] of [['exhaust', '.exhaust-input'], ['inspect', '.uv-input']]) {
    await go(route, selector); check(await value(selector) === '', `${route}: module state cannot resurrect cleared inputs`);
  }
  await go('op/pcapParse');
  await page.locator('#ioIn').evaluate((node, data) => {
    const original = File.prototype.arrayBuffer;
    File.prototype.arrayBuffer = function () {
      if (this.name !== 'delayed.pcap') return original.call(this);
      return new Promise(resolve => { window.releaseDraftFile = () => { File.prototype.arrayBuffer = original; resolve(new Uint8Array(data).buffer); }; });
    };
    const transfer = new DataTransfer(); transfer.items.add(new File([new Uint8Array(data)], 'delayed.pcap'));
    node.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
  }, [...bytes]);
  await page.waitForFunction(() => typeof window.releaseDraftFile === 'function');
  await page.locator('.io-pane-input button[aria-label="清空"]').click();
  await page.evaluate(() => window.releaseDraftFile()); await page.waitForTimeout(200);
  check(await value('#ioIn') === '' && !await page.locator('#ioIn').evaluate(node => !!node._rawBytes), 'Local clear invalidates an in-flight file read');
  await go('op/base64'); await page.locator('#dirSeg button').first().click();
  await page.locator('#ioIn').fill('clear-output'); await convert();
  await page.waitForFunction(() => document.getElementById('ioOut')?.value === 'Y2xlYXItb3V0cHV0');
  await page.locator('.io-pane-input button[aria-label="清空"]').click(); await page.reload();
  await page.locator('#ci_enable_base64').waitFor({ state: 'attached' });
  check(await value('#ioIn') === '' && await value('#ioOut') === '', 'Local clear cannot restore an old output memo after refresh');
  await go('recipe', '.recipe-bar');
  await page.evaluate(async () => {
    const { rState, renderRecipe } = await import('./src/ui/recipeView.js');
    const { getOp, defaultParams } = await import('./src/core/registry.js');
    const op = getOp('base64'), original = op.encode;
    op.encode = (...args) => new Promise(resolve => {
      window.finishDraftRecipe = () => { op.encode = original; resolve(original(...args)); };
    });
    rState.nodes = [{ uid: 'draft-pending-node', opId: 'base64', dir: 'encode', params: defaultParams(op) }];
    rState.input = 'pending recipe'; rState.autoRunMode = 'manual';
    renderRecipe(document.getElementById('workspace'));
  });
  await page.locator('#recipeBake').click(); await page.waitForFunction(() => typeof window.finishDraftRecipe === 'function');
  await page.locator('#btnFont').click(); await page.locator('.env-clear-io').click();
  await page.waitForFunction(() => !document.querySelector('.env-clear-io')?.disabled); await page.keyboard.press('Escape');
  await page.locator('.env-panel').waitFor({ state: 'detached' });
  await page.evaluate(() => window.finishDraftRecipe()); await page.waitForTimeout(150);
  check(await value('#recipeOut') === '' && await value('#recipeIn') === '', 'Clearing IO prevents an in-flight recipe result from returning');
  await page.locator('#recipeIn').fill('again'); await page.locator('#recipeBake').click();
  await page.waitForFunction(() => document.getElementById('recipeOut')?.value === 'YWdhaW4=');
  check(true, 'Recipe can run again after clearing its previous execution');
  await go('op/base64');
  const fallback = await browser.newContext({ serviceWorkers: 'block' });
  await fallback.route(/^https?:\/\/(?:127\.0\.0\.1|localhost):8181\//, bridgeUnavailable);
  await fallback.addInitScript(() => { localStorage.setItem('ebctf_locale', 'zh'); Object.defineProperty(window, 'indexedDB', { value: undefined }); });
  const tab = await fallback.newPage(); tab.on('pageerror', error => errors.push(error.message));
  await tab.goto(new URL('#/op/freqDist', base).href); await tab.locator('#ioIn').fill('journal-only'); await tab.reload();
  await tab.locator('#ci_enable_freqDist').waitFor({ state: 'attached' });
  check(await tab.locator('#ioIn').evaluate(node => node.value) === 'journal-only', 'Text drafts survive refresh with IndexedDB unavailable');
  await fallback.close();
  await page.locator('#btnFont').click();
  await page.getByRole('button', { name: '一键重置程序', exact: true }).click();
  await page.locator('.env-reset-dialog').waitFor();
  await Promise.all([page.waitForEvent('load'), page.getByRole('button', { name: '确认重置', exact: true }).click()]);
  await page.locator('#ioIn').waitFor();
  check(await page.evaluate(() => localStorage.getItem('ebctf.draftTest.keep')) === null, 'Full reset still clears settings');
  await go('op/rsaEgcd'); check(await value('#p_a') === '' && await value('#p_b') === '', 'Full reset also removes draft parameter metadata');
  check(errors.length === 0, `Page errors: ${errors.join('; ')}`);
  console.log(JSON.stringify({ verdict: 'PASS', browser: engine, checks, pageErrors: errors }));
} finally { await browser.close(); }
