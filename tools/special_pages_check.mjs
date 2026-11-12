import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
const option = (key, fallback) => process.argv.includes(key) ? process.argv[process.argv.indexOf(key) + 1] : fallback;
const pw = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = option('--base-url', 'http://127.0.0.1:8180/'), engine = option('--browser', 'chromium');
const channel = option('--channel', undefined), shots = option('--screenshots-dir', undefined);
assert(['127.0.0.1', 'localhost'].includes(new URL(base).hostname));
const browser = await pw[engine].launch({ headless: true, ...(channel ? { channel } : {}) });
const context = await browser.newContext({ viewport: { width: 1366, height: 900 }, serviceWorkers: 'block' });
await context.addInitScript(() => localStorage.setItem('ebctf_locale', 'zh'));
await context.route(/^https?:\/\/(?:127\.0\.0\.1|localhost):8181\//, route => route.fulfill({ status: 503, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*', 'Cross-Origin-Resource-Policy': 'cross-origin' }, body: '{}' }));
const page = await context.newPage(), errors = [];
page.on('pageerror', error => errors.push(error.message));
let checks = 0, stage = '';
const check = (value, label) => { assert(value, `${stage}: ${label}`); checks++; };
const settle = () => page.waitForTimeout(350);
async function go(route, selector = '.op-workbench') {
  await page.goto(new URL(`#/${route}`, base).href);
  await page.locator(selector).first().waitFor(); await settle();
}
async function fit(label) {
  await settle();
  const m = await page.locator('#workspace').evaluate(n => ({ width: n.clientWidth, scroll: n.scrollWidth, document: document.documentElement.scrollWidth, viewport: innerWidth }));
  check(m.scroll <= m.width + 1 && m.document <= m.viewport + 1, `${label} fits ${JSON.stringify(m)}`);
}
const shot = async label => { if (shots) await page.screenshot({ path: join(shots, `special-${engine}-${label}.png`) }); };
const ratio = () => page.locator('.op-workbench').evaluate(n => parseFloat(n.style.getPropertyValue('--op-config-fr')));
async function clearAll() { await page.evaluate(async () => { await (await import('./src/ui/workspaceDrafts.js')).clearWorkspaceDrafts(); }); await settle(); }
async function record(id) {
  return page.evaluate(id => new Promise((resolve, reject) => {
    const r = indexedDB.open('ebctf-workspace-drafts', 1);
    r.onsuccess = () => { const db = r.result, tx = db.transaction('drafts'), q = tx.objectStore('drafts').get(id); q.onsuccess = () => resolve(JSON.parse(JSON.stringify(q.result, (key, value) => value instanceof Blob ? { size: value.size, type: value.type } : ArrayBuffer.isView(value) ? [...value] : value))); q.onerror = reject; tx.oncomplete = () => db.close(); };
    r.onerror = reject;
  }), id);
}
async function openBatch() {
  await page.locator('.io-pane-input .io-tools-more > summary').click();
  await page.locator('.batch-open').click(); await page.locator('.batch-panel').waitFor();
  await page.locator('.batch-panel').evaluate(async n => { await n.ready; });
}
async function closeBatch() { await page.locator('.batch-dialog .exp-close').click(); await page.locator('.batch-overlay').waitFor({ state: 'detached' }); }
try {
  if (process.argv.includes('--audit-inputs')) {
    stage = 'full parameter-only UI inventory';
    await import('../src/core/registerAll.js');
    const { OPS, inferIoMode } = await import('../src/core/registry.js');
    const ids = OPS.filter(op => inferIoMode(op) === 'none' && !op.requiresBridge && op.id !== 'stegSolve').map(op => op.id);
    for (const id of ids) {
      await go(`op/${id}`);
      check(await page.locator('.op-workbench').getAttribute('data-input-mode') === 'none' && !await page.locator('.io-pane-input').isVisible()
        && await page.locator('.op-no-input-note').isVisible(), `${id}: real parameter-only page`);
    }
    check(ids.length === 65, 'all current ordinary no-input pages are accounted for');
  }
  stage = 'input contracts';
  await go('op/rsaModinv');
  check(await page.locator('.op-workbench').getAttribute('data-input-mode') === 'none', 'parameter-only operation has no input pane');
  check(!await page.locator('.io-pane-input').isVisible() && await page.locator('.op-no-input-note').isVisible(), 'no empty input shell');
  await page.locator('#p_a').fill('3'); await page.locator('#p_m').fill('11');
  await page.locator('.io-actions .primary').click();
  await page.waitForFunction(() => document.getElementById('ioOut').textContent.includes('4'));
  check(await page.locator('#ioOut').evaluate(n => n.getBoundingClientRect().height >= 280), 'result uses the data area');
  for (const op of ['freqDist', 'entropy', 'trafficReadable']) {
    await go(`op/${op}`, '#ioIn'); check(await page.locator('#ioIn').isVisible(), `${op} retains text/file input`);
  }

  stage = 'field tools';
  await go('op/rsaCrt');
  check(await page.locator('.io-field-tools').count() === 2, 'each numeric field has its own tools');
  await page.locator('#fld_residues').fill('2, 3, 2'); await page.locator('#fld_moduli').fill('3, 5, 7');
  await page.locator('.io-actions .primary').click();
  await page.waitForFunction(() => document.getElementById('ioOut').textContent.includes('23'));
  const first = page.locator('.io-field').first();
  await first.locator('button[title="清空"]').click();
  check(await page.locator('#fld_residues').textContent() === '' && await page.locator('#fld_moduli').textContent() === '3, 5, 7', 'clearing one field preserves the other');
  await first.locator('input[type="file"]').setInputFiles({ name: 'residues.txt', mimeType: 'text/plain', buffer: Buffer.from('2, 3, 2') });
  await page.waitForFunction(() => document.getElementById('fld_residues').textContent === '2, 3, 2');
  await first.locator('button[title="展开编辑"]').click(); await page.locator('.exp-textarea').fill('2,3,2');
  await page.locator('.exp-save').click(); await page.locator('.exp-dialog').waitFor({ state: 'detached' });
  check(await page.locator('#fld_residues').textContent() === '2,3,2', 'expanded field saves into the correct target');
  check(await page.locator('.io-swap').isDisabled() && await page.locator('.io-chain').isDisabled(), 'structured fields have no invalid swap/chain target');
  await page.locator('.io-pane-output .io-tools-more > summary').click();
  await page.locator('.io-pane-output button[title="展开编辑"]').click();
  check(await page.locator('.exp-textarea').evaluate(n => n.readOnly) && await page.locator('.exp-save').count() === 0, 'expanded result is read-only and has no writeback action');
  await page.keyboard.press('Escape'); await page.locator('.exp-dialog').waitFor({ state: 'detached' });
  check(await page.locator('.io-pane-output .io-tools-more > summary').evaluate(n => n === document.activeElement), 'expanded result returns focus to its visible launcher');
  await page.locator('.io-pane-output .io-tools-more > summary').click();
  await page.locator('.io-pane-output button[title="展开编辑"]').click();
  await clearAll(); await page.locator('.exp-dialog').waitFor({ state: 'detached' });
  check(await page.locator('#ioOut').textContent() === '', 'global clear dismisses expanded result snapshots');
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true,
    value: { readText: () => new Promise(resolve => { window.releaseFieldPaste = resolve; }) } }));
  await first.locator('button[title="粘贴"]').click();
  await page.waitForFunction(() => typeof window.releaseFieldPaste === 'function');
  await clearAll(); await page.evaluate(() => window.releaseFieldPaste('late paste')); await settle();
  check(await page.locator('#fld_residues').textContent() === '' && await page.locator('#fld_moduli').textContent() === '', 'late field paste cannot revive globally cleared data');
  await fit('structured fields');
  await go('op/babaiCvp');
  await page.locator('#fld_basis').fill('4 0'); await page.locator('#fld_basis').press('End'); await page.locator('#fld_basis').press('Enter'); await page.keyboard.type('0 4');
  await page.locator('#fld_target').fill('5 9'); await page.locator('.io-actions .primary').click();
  await page.waitForFunction(() => document.getElementById('ioOut').textContent.includes('最近格点 v = [4, 8]'));
  check(true, 'Babai fields preserve matrix/vector boundaries and execute the unique nearest-grid-point sample');
  const fieldTops = await page.locator('.io-field-area').evaluateAll(nodes => nodes.map(n => n.getBoundingClientRect().top));
  check(Math.abs(fieldTops[0] - fieldTops[1]) <= 1, 'long and short field headings keep editor top edges aligned');

  stage = 'per-tool ratio';
  await go('op/base64'); await page.locator('.op-splitter').press('Enter');
  for (let i = 0; i < 6; i++) await page.locator('.op-splitter').press('ArrowRight');
  const savedRatio = await ratio(); check(savedRatio > .55, 'keyboard resize changes this tool');
  await go('op/rot13'); check(Math.abs(await ratio() - .5) < .01, 'another operation starts equally split');
  await go('op/base64'); check(Math.abs(await ratio() - savedRatio) < .01, 'returning restores the operation ratio');
  await page.reload(); await page.locator('.op-splitter').waitFor(); await settle();
  check(Math.abs(await ratio() - savedRatio) < .01, 'refresh restores the operation ratio');
  await clearAll(); check(Math.abs(await ratio() - savedRatio) < .01, 'IO-only clear preserves layout preference');
  await page.setViewportSize({ width: 390, height: 844 }); await settle();
  check(await page.locator('.op-workbench').getAttribute('data-layout') === 'stack', 'portrait stacks');
  await page.setViewportSize({ width: 1366, height: 900 }); await settle();
  check(Math.abs(await ratio() - savedRatio) < .01, 'landscape restores the stored fraction');
  await page.locator('.op-splitter').press('Enter');

  stage = 'recipe workbench';
  await go('recipe', '.recipe-workbench');
  check(await page.locator('.special-config #recipeChain').count() === 1 && await page.locator('.special-data #recipeIn').count() === 1 && await page.locator('.special-data #recipeOut').count() === 1, 'chain in settings; input/output together on the right');
  check(await page.locator('.recipe-workbench > .special-config').evaluate(n => {
    const run = n.querySelector('.recipe-bar-run'), bar = n.querySelector('.recipe-bar');
    return n.firstElementChild === run && run.contains(document.getElementById('recipeBake'))
       && run.contains(document.getElementById('recipeStepBtn'))
      && run.getBoundingClientRect().bottom <= bar.getBoundingClientRect().top;
  }), 'Bake and Step occupy the top of the left column');
  async function recipeToolsFit(label) {
    for (const selector of ['.recipe-input-block', '.recipe-output-block']) {
      check(await page.locator(selector).evaluate(n => {
        const area = n.querySelector('.io-area'), head = n.querySelector('.io-pane-head');
        const box = area.getBoundingClientRect(), toolbar = head.getBoundingClientRect();
        const padding = parseFloat(getComputedStyle(area).paddingTop);
        const tools = [...head.querySelectorAll(':scope > .io-pane-tools > button, :scope > .io-pane-tools > details > summary')]
          .filter(n => n.getBoundingClientRect().width);
        return !n.querySelector('.et-toolbar') && tools.every(n => {
          const r = n.getBoundingClientRect(); return r.left >= box.left && r.right <= box.right && r.top >= box.top && r.bottom <= box.bottom;
        }) && toolbar.bottom <= box.top + padding && head.closest('.io-editor-frame') === area.parentElement;
      }), `${label}: ${selector} tools remain inside the editor without overlapping text`);
    }
    check(await page.locator('.recipe-input-block .io-editor-frame > .io-pane-head > .io-pane-tools > button[title="载入文件到链头"]').count() === 1,
      `${label}: chain-head upload uses the same embedded toolbar`);
  }
  await recipeToolsFit('desktop');
  await page.locator('.recipe-op-search-input').fill('base64'); await page.locator('.recipe-op-search-item').first().click();
  await page.locator('.recipe-node-dir').first().selectOption('encode');
  if (await page.locator('#recipeAutoToggle').isChecked()) await page.locator('label[for="recipeAutoToggle"]').click();
  if (!await page.locator('#recipeStepToggle').isChecked()) await page.locator('label[for="recipeStepToggle"]').click();
  const [chainFileChooser] = await Promise.all([page.waitForEvent('filechooser'), page.locator('.recipe-input-block .io-pane-tools > button[title="载入文件到链头"]').click()]);
  await chainFileChooser.setFiles({ name: 'chain-head.txt', mimeType: 'text/plain', buffer: Buffer.from('file input') });
  await page.waitForFunction(() => document.getElementById('recipeIn').textContent.includes('chain-head.txt'));
  await page.locator('#recipeBake').click();
  await page.waitForFunction(() => document.getElementById('recipeOut').textContent === 'ZmlsZSBpbnB1dA==');
  check(true, 'embedded upload loads the chain head and executes its contents');
  await page.locator('.recipe-input-block button[title="清空"]').click();
  check(await page.locator('#recipeIn').textContent() === '', 'embedded clear empties the input');
  await page.locator('#recipeIn').fill('undo seed');
  await page.locator('.recipe-input-block button[title="清空"]').click();
  await page.locator('.recipe-input-block .io-pane-tools > button[title^="撤销"]').click();
  check(await page.locator('#recipeIn').textContent() === 'undo seed', 'embedded undo restores the input and updates the chain state');
  await page.locator('#recipeIn').fill('test'); await page.locator('#recipeBake').click();
  await page.waitForFunction(() => document.getElementById('recipeOut').textContent === 'dGVzdA==');
  await page.locator('.recipe-step').last().click();
  check(await page.locator('#recipeStepOut').textContent() === 'dGVzdA==', 'step inspector shows the selected step, preserving the final result');
  await page.locator('#recipeToggleArguments').click(); check(!await page.locator('.recipe-node-params').first().isVisible(), 'recipe arguments can be hidden without rebuilding nodes');
  await page.locator('#recipeToggleArguments').click();
  await page.evaluate(async () => {
    const { rState, renderRecipe } = await import('./src/ui/recipeView.js');
    rState.nodes = [
      { kind: 'control', control: 'fork', params: { splitMode: 'line', splitter: '\\n', mergeDelimiter: '', removeEmpty: false, ignoreErrors: false } },
      { opId: 'base64', dir: 'encode', params: {} }, { kind: 'control', control: 'merge', params: { join: '\\n', mergeAll: true } },
    ];
    rState.autoRunMode = 'manual'; renderRecipe();
  });
  await page.locator('#recipeIn').fill('A'); await page.locator('#recipeIn').press('End'); await page.locator('#recipeIn').press('Enter'); await page.keyboard.type('B');
  await page.locator('#recipeBake').click(); await page.waitForFunction(() => document.getElementById('recipeOut').textContent === 'QQ==\nQg==');
  check(await page.locator('.recipe-node[data-branch-depth="1"]').count() === 1, 'Fork/Merge retain execution and visible nesting');
  await fit('recipe desktop'); await shot('recipe-desktop');
  const [recipeDownload] = await Promise.all([page.waitForEvent('download'), page.locator('.recipe-output-block button[title="导出为文件"]').click()]);
  const recipeStream = await recipeDownload.createReadStream(), recipeData = []; for await (const chunk of recipeStream) recipeData.push(chunk);
  check(Buffer.concat(recipeData).toString() === 'QQ==\nQg==', 'embedded output export preserves the final result');
  await page.locator('.recipe-output-block .io-tools-more > summary').click();
  await page.locator('.recipe-output-block button[title="展开编辑"]').click();
  check(await page.locator('.exp-textarea').evaluate(n => n.readOnly), 'embedded result expansion remains read-only');
  await page.keyboard.press('Escape'); await page.locator('.exp-dialog').waitFor({ state: 'detached' });
  await page.setViewportSize({ width: 320, height: 844 }); await fit('recipe mobile'); await recipeToolsFit('mobile'); await shot('recipe-mobile');
  await page.setViewportSize({ width: 1366, height: 900 });

  const pngData = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = c.height = 32; const ctx = c.getContext('2d'); ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 32, 32); ctx.fillStyle = '#000000'; ctx.fillRect(8, 8, 16, 16); return c.toDataURL(); });
  const png = Buffer.from(pngData.split(',')[1], 'base64');
  stage = 'code-image workspace and draft';
  await go('codeimg', '.ci-card');
  check(await page.locator('.ci-view').evaluate(n => {
    const recognition = n.querySelector(':scope > .ci-rec'), body = n.querySelector(':scope > .ci-body');
    const side = body?.querySelector(':scope > .ci-side'), main = body?.querySelector(':scope > .ci-main');
    return recognition && side && main && !n.querySelector('.op-splitter, .ci-chart-preview')
      && recognition.getBoundingClientRect().bottom <= body.getBoundingClientRect().top
      && getComputedStyle(side.querySelector('.ci-tree')).flexDirection === 'column'
      && side.getBoundingClientRect().right <= main.getBoundingClientRect().left;
  }), 'original code-image layout: recognition above, vertical categories beside the thumbnail grid');
  await page.locator('.ci-card').nth(1).click(); await page.locator('.ci-modal-dialog').waitFor();
  check(await page.locator('.ci-modal-img').count() === 1, 'thumbnail selection opens the original full-screen viewer directly');
  await page.keyboard.press('Escape'); await page.locator('.ci-modal-dialog').waitFor({ state: 'detached' });
  await page.locator('.ci-rec-file').setInputFiles({ name: 'glyph.png', mimeType: 'image/png', buffer: png });
  await page.locator('.ci-rec-preview img').waitFor({ timeout: 90000 }); await settle();
  const imageRecord = await record('special:codeimg');
  check(imageRecord.meta.special.file.size === png.length, 'recognition draft stores the original file');
  await page.reload(); await page.locator('.ci-rec-preview img').waitFor({ timeout: 30000 });
  check(await page.locator('.ci-rec-status').textContent() === '', 'completed recognition restores without rerunning');
  await page.locator('.ci-rec-actions button').nth(1).click(); await page.locator('.imgops-overlay').waitFor();
  await page.locator('[data-imgops="more"]').click(); await page.locator('#imgops-tab-transform').click();
  for (const [key, value] of [['x', '8'], ['y', '8'], ['w', '16'], ['h', '16']]) await page.locator(`[data-imgops="crop-${key}"]`).fill(value);
  await page.locator('[data-imgops="crop-apply"]').click(); await page.locator('[data-imgops="use-input"]').click();
  await page.locator('.imgops-overlay').waitFor({ state: 'detached' }); await page.locator('.ci-rec-preview img').waitFor(); await settle();
  check((await page.locator('.ci-rec-sub').first().textContent()).includes('16×16'), 'cropped image is used for recognition');
  await page.reload(); await page.locator('.ci-rec-preview img').waitFor();
  check((await page.locator('.ci-rec-sub').first().textContent()).includes('16×16'), 'crop survives reload as encoded image data');
  await page.locator('.ci-rec-actions button').last().click();
  await page.waitForFunction(() => [...document.querySelectorAll('.ci-rec-sub')].some(n => n.textContent.includes('32×32')));
  check(true, 'original image remains available after cropping');
  await fit('code-image desktop'); await shot('codeimg-desktop');
  await page.setViewportSize({ width: 320, height: 844 }); await fit('code-image mobile');
  check(await page.locator('.ci-body').evaluate(n => getComputedStyle(n).flexDirection === 'column' && !n.querySelector('.op-splitter')), 'code-image keeps its original narrow-screen layout');
  await page.setViewportSize({ width: 1366, height: 900 });

  stage = 'StegSolve workspace and draft';
  await go('op/stegSolve', '.sspage-workbench');
  await page.locator('input[aria-label="打开图像"]').setInputFiles({ name: 'source.png', mimeType: 'image/png', buffer: png });
  await page.waitForFunction(() => document.querySelector('.sspage-name').textContent === 'source.png');
  await page.locator('[data-controls="transform"] .sspage-nav').nth(1).click();
  await page.locator('.sspage-tab').filter({ hasText: '图像合并' }).click();
  await page.locator('input[aria-label="选择第二张图像"]').setInputFiles({ name: 'second.png', mimeType: 'image/png', buffer: png });
  await settle(); await page.locator('.sspage-tab').filter({ hasText: '图像变换' }).click(); await settle();
  check(await page.locator('.special-data .sspage-canvas').count() >= 1 && await page.locator('.special-config .sspage-tabs').count() === 1, 'controls and canvases occupy their own regions');
  await page.reload(); await page.waitForFunction(() => document.querySelector('.sspage-name')?.textContent === 'source.png');
  check((await page.locator('.sspage-transform-index').textContent()).startsWith('2 /'), 'transform selection survives reload');
  const steg = await record('special:stegsolve');
  check(steg.meta.special.file.size === png.length && steg.meta.special.secondFile.size === png.length, 'both original files survive reload');
  await fit('StegSolve desktop'); await shot('stegsolve-desktop');
  await page.setViewportSize({ width: 320, height: 844 }); await fit('StegSolve mobile'); await shot('stegsolve-mobile');
  await page.locator('.sspage-toolbar button').filter({ hasText: '帧/通道总览' }).click();
  await page.locator('.sspage-gallery-overlay').waitFor(); await settle();
  check((await page.locator('.sspage-gallery-tab').first().textContent()).includes('(1)'), 'gallery frame tab counts source frames');
  await page.locator('.sspage-gallery-tab').nth(1).click(); await settle();
  check(await page.locator('.sspage-gallery-cell').count() === 42, 'gallery lists all 42 channel transforms');
  const [galleryZip] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('.sspage-gallery-actions button').first().click(),
  ]);
  let galleryZipBytes = 0;
  const galleryStream = await galleryZip.createReadStream();
  for await (const chunk of galleryStream) galleryZipBytes += chunk.length;
  check(galleryZipBytes > 1000 && /stegsolve_frames_channels\.zip$/.test(galleryZip.suggestedFilename()), 'frames/channels batch export downloads a ZIP');
  await page.keyboard.press('Escape'); await page.locator('.sspage-gallery-overlay').waitFor({ state: 'detached' });
  await clearAll();
  check(await page.locator('.sspage-drop').isVisible(), 'global clear removes canvas input');
  await page.evaluate(() => {
    const original = File.prototype.arrayBuffer;
    File.prototype.arrayBuffer = async function() { if (this.name === 'late-image.png') await new Promise(resolve => setTimeout(resolve, 500)); return original.call(this); };
  });
  await page.locator('input[aria-label="打开图像"]').setInputFiles({ name: 'late-image.png', mimeType: 'image/png', buffer: png });
  await clearAll(); await page.waitForTimeout(600);
  check(await page.locator('.sspage-drop').isVisible() && await page.locator('.sspage-name').textContent() === '', 'late image decoding cannot revive cleared input');
  await page.setViewportSize({ width: 1366, height: 900 });

  stage = 'large report and multi-product rendering';
  await page.evaluate(async dataURL => {
    const { register } = await import('./src/core/registry.js');
    const bytes = Uint8Array.from(atob(dataURL.split(',')[1]), c => c.charCodeAt(0));
    register({ id: 'uiResultFixture', cat: 'analysis', name: 'UI result fixture', params: [], io: 'none', run: () => ({
      text: Array.from({ length: 200 }, (_, i) => `Report line ${i}`).join('\n'),
      files: [{ name: 'picture.png', mime: 'image/png', bytes }, { name: 'result.txt', mime: 'text/plain', bytes: new TextEncoder().encode('exact result') }],
    }) });
  }, pngData);
  await go('op/uiResultFixture'); await page.locator('.io-actions .primary').click(); await page.locator('.io-out-file-row').first().waitFor();
  check(await page.locator('.io-out-file-row').count() === 2 && await page.locator('.io-out-preview-img').count() === 1, 'multiple products show image preview inline and compact rows');
  check(await page.locator('#ioOut').evaluate(n => n.scrollHeight > n.clientHeight), 'long report scrolls inside its output editor');
  await page.waitForFunction(() => { const img = document.querySelector('.io-out-preview-img'); return img && img.complete && img.naturalWidth > 0; });
  check(await page.locator('.io-out-preview-img').evaluate(n => n.naturalWidth === 32), 'image file preview renders inline without download');
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('.io-out-file-row').last().getByRole('button').click()]);
  const stream = await download.createReadStream(), chunks = []; for await (const chunk of stream) chunks.push(chunk);
  check(Buffer.concat(chunks).toString() === 'exact result', 'file-list download preserves exact bytes');

  stage = 'batch file/result draft';
  await go('op/base64'); await page.locator('#dirSeg button').first().click(); await openBatch();
  await page.locator('.batch-panel input[type="file"]').first().setInputFiles([
    { name: 'one.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') },
    { name: 'two.txt', mimeType: 'text/plain', buffer: Buffer.from('world') },
  ]);
  await page.locator('.batch-panel .bp-primary').click();
  await page.waitForFunction(() => [...document.querySelector('.batch-panel').getState().entries].filter(e => e.status === 'ok').length === 2);
  await settle(); await closeBatch(); await page.reload(); await page.locator('#ioIn').waitFor(); await openBatch();
  const batch = await page.locator('.batch-panel').evaluate(n => n.getState());
  check(batch.entries.length === 2 && batch.entries.every(e => e.status === 'ok' && e.bytes > 0), 'queue and completed products restore');
  const batchRecord = await record('special:batch:base64:encode');
  check(new TextDecoder().decode(Uint8Array.from(batchRecord.meta.special.entries[0].bytes)) === 'aGVsbG8=', 'completed binary product is exact');
  await closeBatch(); await page.locator('#dirSeg button').last().click(); await openBatch();
  check((await page.locator('.batch-panel').evaluate(n => n.getState())).entries.length === 0, 'encode and decode queues are isolated');
  await closeBatch(); await page.locator('#dirSeg button').first().click();

  stage = 'interrupted batch and clear race';
  await page.evaluate(async () => {
    const original = File.prototype.arrayBuffer;
    File.prototype.arrayBuffer = async function() { if (this.name === 'slow.txt') await new Promise(resolve => setTimeout(resolve, 10000)); return original.call(this); };
  });
  await openBatch(); await page.locator('.batch-panel').getByRole('button', { name: '清空列表', exact: true }).click();
  await page.locator('.batch-panel input[type="file"]').first().setInputFiles([
    { name: 'fast.txt', mimeType: 'text/plain', buffer: Buffer.from('fast') }, { name: 'slow.txt', mimeType: 'text/plain', buffer: Buffer.from('slow') },
  ]);
  await page.locator('.batch-panel .bp-primary').click();
  await page.waitForFunction(() => { const e = document.querySelector('.batch-panel').getState().entries; return e[0]?.status === 'ok' && e[1]?.status === 'running'; });
  await settle(); await page.reload(); await page.locator('#ioIn').waitFor(); await openBatch();
  const interrupted = await page.locator('.batch-panel').evaluate(n => n.getState());
  check(interrupted.entries[0].status === 'ok' && interrupted.entries[1].status === 'pending' && !await page.locator('.batch-panel').evaluate(n => n.isBusy()), `refresh preserves completed output and leaves interrupted work pending: ${JSON.stringify(interrupted)}`);
  await page.locator('.batch-panel .bp-primary').click();
  await page.waitForFunction(() => document.querySelector('.batch-panel').getState().entries.every(e => e.status === 'ok'));
  check(true, 'explicit resume completes only the pending entries');
  await closeBatch();
  await page.evaluate(async () => {
    const original = File.prototype.arrayBuffer;
    File.prototype.arrayBuffer = async function() { if (this.name === 'late.txt') await new Promise(resolve => setTimeout(resolve, 500)); return original.call(this); };
  });
  await openBatch(); await page.locator('.batch-panel').getByRole('button', { name: '清空列表', exact: true }).click();
  await page.locator('.batch-panel input[type="file"]').first().setInputFiles({ name: 'late.txt', mimeType: 'text/plain', buffer: Buffer.from('late') });
  await page.locator('.batch-panel .bp-primary').click();
  await page.waitForFunction(() => document.querySelector('.batch-panel').getState().entries[0]?.status === 'running');
  await clearAll(); await page.waitForTimeout(650);
  check((await page.locator('.batch-panel').evaluate(n => n.getState())).entries.length === 0 && !await page.locator('.batch-panel').evaluate(n => n.isBusy()), 'global clear invalidates late batch results');
  await closeBatch();

  stage = 'clear reaches closed image drafts';
  await go('codeimg', '.ci-card');
  check(await page.locator('.ci-rec-preview').count() === 0, 'cleared recognition file/result cannot revive');
  await go('op/stegSolve', '.sspage-workbench'); await settle();
  check(await page.locator('.sspage-drop').isVisible(), 'closed StegSolve draft remains cleared');

  stage = 'binary storage failure';
  const fallback = await browser.newContext({ viewport: { width: 1366, height: 900 }, serviceWorkers: 'block' });
  await fallback.addInitScript(() => { localStorage.setItem('ebctf_locale', 'zh'); Object.defineProperty(window, 'indexedDB', { value: null, configurable: true }); });
  const tab = await fallback.newPage(); tab.on('pageerror', error => errors.push(error.message));
  await tab.goto(new URL('#/op/stegSolve', base).href); await tab.locator('input[aria-label="打开图像"]').waitFor({ state: 'attached' });
  await tab.locator('input[aria-label="打开图像"]').setInputFiles({ name: 'unsaved.png', mimeType: 'image/png', buffer: png });
  await tab.locator('.toast').filter({ hasText: '草稿存储失败' }).waitFor(); check(true, 'binary storage failure is reported even when the text journal succeeds');
  await tab.reload(); await tab.locator('.sspage-status').filter({ hasText: '草稿文件未保存' }).waitFor();
  check(true, 'reload explicitly reports the missing draft file'); await fallback.close();
  check(errors.length === 0, `page errors: ${errors.join('; ')}`);
  console.log(JSON.stringify({ verdict: 'PASS', engine, checks, pageErrors: errors }));
} catch (error) { console.error(`Stage: ${stage}; page errors: ${errors.join('; ')}`); throw error; }
finally { await browser.close(); }
