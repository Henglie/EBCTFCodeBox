import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
const option = (key, fallback) => process.argv.includes(key) ? process.argv[process.argv.indexOf(key) + 1] : fallback;
const pw = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = option('--base-url', 'http://127.0.0.1:8180/'), engine = option('--browser', 'chromium');
const channel = option('--channel', undefined), shots = option('--screenshots-dir', undefined);
assert(['localhost', '127.0.0.1'].includes(new URL(base).hostname));
const browser = await pw[engine].launch({ headless: true, ...(channel ? { channel } : {}) });
const context = await browser.newContext({ viewport: { width: 1366, height: 900 }, serviceWorkers: 'block' });
await context.addInitScript(() => localStorage.setItem('ebctf_locale', 'zh'));
await context.route(/^https?:\/\/(?:127\.0\.0\.1|localhost):8181\//, route => route.fulfill({ status: 503, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*', 'Cross-Origin-Resource-Policy': 'cross-origin' }, body: '{}' }));
const page = await context.newPage(), errors = [], measurements = [];
page.on('pageerror', e => errors.push(e.message));
let checks = 0, stage = '';
const check = (value, label) => { assert(value, `${stage}: ${label}`); checks++; };
const content = () => page.locator('.ci-editor-wrap .cm-content');
async function state() {
  return content().evaluate(async node => {
    const { EditorView } = await import('./src/vendor/codemirror.bundle.js');
    const view = EditorView.findFromDOM(node), selection = view.state.selection.main;
    return { text: view.state.doc.toString(), anchor: selection.anchor, head: selection.head,
      scroll: view.scrollDOM.scrollTop, font: parseFloat(getComputedStyle(view.dom).fontSize), lineHeight: parseFloat(getComputedStyle(view.scrollDOM).lineHeight) };
  });
}
async function fixture(text, anchor = 0, head = anchor) {
  await content().evaluate(async (node, p) => {
    const { EditorView } = await import('./src/vendor/codemirror.bundle.js');
    const view = EditorView.findFromDOM(node);
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: p.text }, selection: { anchor: p.anchor, head: p.head }, userEvent: 'setCode' }); view.focus();
  }, { text, anchor, head });
}
const savedCode = () => page.evaluate(async () => (await import('./src/core/customImplStore.js')).getCustomImpl('freqDist')?.code);
const settle = () => page.waitForTimeout(180);
async function fit(label) {
  const m = await page.locator('.ci-dialog').evaluate(n => {
    const foot = n.querySelector('.ci-foot'), editor = n.querySelector('.ci-editor-wrap').getBoundingClientRect();
    return { width: n.clientWidth, scroll: n.scrollWidth, footerWidth: foot.clientWidth, footerScroll: foot.scrollWidth, editorHeight: editor.height,
      viewport: innerWidth, bodyWidth: document.documentElement.scrollWidth,
      ...(n.scrollWidth > n.clientWidth + 1 ? { offenders: [...n.querySelectorAll('*')].filter(e => { const r = e.getBoundingClientRect(); return r.width && r.right > n.getBoundingClientRect().right + 1 && !e.closest('.cm-scroller'); }).map(e => ({ cls: e.className, width: e.getBoundingClientRect().width, right: e.getBoundingClientRect().right, text: e.textContent.slice(0, 60) })) } : {}) };
  });
  check(m.scroll <= m.width + 1 && m.footerScroll <= m.footerWidth + 1 && m.bodyWidth <= m.viewport + 1, `${label}: shell and footer fit ${JSON.stringify(m)}`);
  check(m.editorHeight >= 100, `${label}: usable editing canvas ${JSON.stringify(m)}`);
  return m;
}
try {
  stage = 'initial input policy';
  await page.goto(new URL('#/op/freqDist', base).href); await page.locator('.ci-edit-btn').waitFor();
  await page.locator('.ci-edit-btn').click(); await content().waitFor();
  await page.waitForFunction(() => document.querySelector('.ci-status-message')?.textContent.includes('已载入完整实现'));
  const initial = await state();
  check(initial.font === 15 && initial.lineHeight === 23, `readable default font, not Number(null)=0: ${JSON.stringify(initial).slice(-160)}`);
  check(initial.head === 0 && initial.scroll <= 1, 'automatic source loading keeps the caret at the beginning');
  check(await page.locator('.ci-spanel .cm-editor').count() === 0, 'hidden source comparison creates no unused editor');
  check(await content().getAttribute('spellcheck') === 'false' && !!await content().getAttribute('aria-label'), 'code-specific accessible input attributes');

  stage = 'native editing';
  await fixture('if (true) {}', 11); await content().press('Enter');
  check((await state()).text === 'if (true) {\n  \n}', 'Enter indents the block and keeps the closing brace on its own line');
  await fixture(''); await content().press('(');
  check((await state()).text === '()' && (await state()).head === 1, 'bracket pairing keeps the caret between the pair');
  await content().press('Backspace'); check((await state()).text === '', 'paired Backspace removes both brackets');
  const twoLines = 'const a = 1;\nconst b = 2;';
  await fixture(twoLines, 0, twoLines.length); await content().press('Tab');
  check((await state()).text === '  const a = 1;\n  const b = 2;', 'Tab indents every selected line by two spaces');
  await content().press('Shift+Tab'); check((await state()).text === twoLines, 'Shift+Tab restores the original indentation');
  await content().press('Control+/'); check((await state()).text.includes('//'), 'comment shortcut is actually wired');
  await content().press('Control+z'); check((await state()).text === twoLines, 'native undo restores the commented selection');
  await content().press('Control+Shift+Z'); check((await state()).text.includes('//'), `native redo restores the comment operation: ${JSON.stringify(await state())}`);
  await fixture('');
  await content().evaluate(node => {
    // Firefox protects a synthetic DataTransfer store. Supply the actual
    // clipboard contract directly, leaving CM's production paste handler intact.
    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: { types: ['text/plain'], files: [],
      getData: type => type === 'text/plain' ? 'A\r\n中文😀\r\nB' : '' } });
    node.dispatchEvent(event);
  });
  await settle();
  check((await state()).text === 'A\n中文😀\nB', `plain-text paste preserves Unicode and normalizes CRLF: ${JSON.stringify(await state())}`);
  await content().press('Control+z'); check((await state()).text === '', 'paste is one native undo step');
  await content().press('Control+m'); await content().press('Tab');
  check(await content().evaluate(n => n !== document.activeElement), 'Ctrl+M permits keyboard navigation out of the code editor');
  await content().focus(); await content().press('Control+m');

  stage = 'search and composition ownership';
  await fixture('return input;'); await content().press('Control+f'); await page.locator('.ci-editor-wrap .cm-search').waitFor();
  await page.locator('.ci-editor-wrap .cm-search input[name="search"]').fill('input');
  await page.keyboard.press('Escape'); await settle();
  check(await page.locator('.ci-dialog').count() === 1 && await page.locator('.ci-editor-wrap .cm-search').count() === 0, 'Escape closes search first, keeping the editor open');
  await content().evaluate(node => node.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', isComposing: true, bubbles: true, cancelable: true })));
  check(await page.locator('.ci-dialog').count() === 1, 'composing Escape does not close the editor');

  stage = 'save, test and result ownership';
  await fixture('return "saved";'); await content().press('Control+s');
  check(await savedCode() === 'return "saved";' && await page.locator('.ci-dialog').getAttribute('data-dirty') === 'false', 'Ctrl+S saves without closing or losing focus');
  await fixture('return "tested";'); await content().press('Control+Enter');
  await page.waitForFunction(() => document.querySelector('.ci-status-message')?.textContent.includes('运行成功'));
  check(await savedCode() === 'return "saved";', 'test run does not implicitly overwrite saved code');
  await content().press('ArrowRight');
  check((await page.locator('.ci-status-message').textContent()).includes('运行成功'), 'cursor movement does not erase the test result');
  await content().pressSequentially(' ');
  check((await page.locator('.ci-status-message').textContent()).includes('重新测试'), 'editing explicitly invalidates the old test result');

  stage = 'session draft and toolbar history';
  await fixture('return "unsaved";', 5); await content().press('Escape'); await page.locator('.ci-dialog').waitFor({ state: 'detached' });
  await page.locator('.ci-edit-btn').click(); await content().waitFor();
  check((await state()).text === 'return "unsaved";' && (await state()).head === 5, 'close/reopen restores the unsaved document and selection');
  check(await page.locator('.ci-dialog').getAttribute('data-dirty') === 'true', 'restored unsaved code is visibly identified');
  await fixture(''); await content().press('Escape'); await page.locator('.ci-dialog').waitFor({ state: 'detached' });
  await page.locator('.ci-edit-btn').click(); await content().waitFor();
  check((await state()).text === '', 'an intentionally empty unsaved document does not revert to a template');
  await fixture('return 123;'); await page.locator('.ci-editor-more > summary').click();
  await page.locator('.ci-editor-more-menu button').filter({ hasText: '重置为模板' }).click();
  check((await state()).text !== 'return 123;', 'secondary actions remain available in More');
  await page.locator('.ci-editor-toolbar button[title^="撤销"]').click();
  check((await state()).text === 'return 123;', 'toolbar undo precisely restores the replaced document');
  await page.locator('.ci-editor-toolbar button[title^="重做"]').click();
  check((await state()).text !== 'return 123;', 'toolbar redo reapplies the replacement');

  stage = 'source comparison';
  await page.locator('.ci-src-head-toggle').click(); await page.locator('.ci-spanel .cm-content').waitFor();
  check(await page.locator('.ci-spanel .cm-content').getAttribute('contenteditable') === 'false', 'source comparison remains read-only');
  await page.locator('.ci-spanel .cm-content').focus(); await page.keyboard.press('Control+a');
  check(await page.locator('.ci-spanel .cm-content').evaluate(async node => {
    const { EditorView } = await import('./src/vendor/codemirror.bundle.js'); const view = EditorView.findFromDOM(node);
    const selected = view.state.selection.main; return selected.from === 0 && selected.to === view.state.doc.length;
  }), 'read-only Select All targets its own document rather than the whole page');
  const sourceLength = await page.locator('.ci-spanel .cm-content').textContent(); await page.keyboard.press('Backspace');
  check(await page.locator('.ci-spanel .cm-content').textContent() === sourceLength, 'read-only navigation keymap never enables document deletion');
  await page.locator('.ci-spanel .cm-content').focus(); await page.keyboard.press('Control+f'); await page.locator('.ci-spanel .cm-search').waitFor();
  await page.keyboard.press('Escape');
  check(await page.locator('.ci-dialog').count() === 1 && await page.locator('.ci-spanel .cm-search').count() === 0, 'read-only source owns search and Escape independently');
  await page.locator('.ci-src-head-toggle').click();
  await fixture('a+b');
  await content().evaluate(async node => {
    const { EditorView } = await import('./src/vendor/codemirror.bundle.js');
    const view = EditorView.findFromDOM(node), Selection = view.state.selection.constructor;
    view.dispatch({ selection: Selection.create([Selection.range(0, 1), Selection.range(2, 3)]) });
  });
  await page.locator('.ci-tools-toggle').click();
  await page.locator('.ci-panel .ci-chip').filter({ hasText: /^input$/ }).click();
  check((await state()).text === 'input+input', 'helper insertion replaces all active selections atomically');
  await page.locator('.ci-tools-toggle').click();

  stage = 'long document position';
  const large = '// line\n'.repeat(10000) + 'return input;'; await fixture(large, large.length);
  check((await page.locator('.ci-position').textContent()).includes('10001'), 'line/column stays correct at the end of a 10000-line document');
  const positionWork = await content().evaluate(async node => {
    const { EditorView } = await import('./src/vendor/codemirror.bundle.js'); const view = EditorView.findFromDOM(node), doc = view.state.doc;
    const head = doc.length, rounds = 2000;
    let check = 0, start = performance.now();
    for (let i = 0; i < rounds; i++) { const line = doc.lineAt(head); check += line.number + head - line.from + 1; }
    const indexedMs = performance.now() - start; start = performance.now();
    for (let i = 0; i < rounds; i++) { const lines = doc.sliceString(0, head).split('\n'); check -= lines.length + lines.at(-1).length + 1; }
    return { rounds, lines: doc.lines, indexedMs, previousMs: performance.now() - start, sameResult: check === 0 };
  });
  check(positionWork.sameResult, 'indexed line lookup matches the old full-prefix implementation');
  measurements.push({ positionWork });
  await fixture('return input;');
  stage = 'responsive tonal surfaces';
  for (const theme of ['light', 'dark']) for (const [width, height] of [[1440, 900], [1366, 768], [390, 844], [320, 844], [844, 390]]) {
    await page.setViewportSize({ width, height }); await page.evaluate(v => window.__ebctfToggleTheme(v), theme); await settle();
    measurements.push({ theme, width, height, ...await fit(`${theme}/${width}x${height}`) });
    if (width <= 860) check(await page.locator('.ci-editor-toolbar button[title^="自动换行"]').getAttribute('aria-pressed') === 'true', 'unset wrapping preference adapts to a narrow viewport');
    if (shots && [1440, 390].includes(width)) await page.screenshot({ path: join(shots, `custom-editor-${engine}-${theme}-${width}.png`) });
  }
  await page.locator('.ci-header-close').click(); await page.locator('.ci-dialog').waitFor({ state: 'detached' });
  check(await page.locator('[inert]').count() === 0, 'closing restores the background and focus isolation');

  stage = 'late callbacks';
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.evaluate(async () => {
    const { openCustomImplEditor } = await import('./src/ui/customImplEditor.js');
    const { getOp } = await import('./src/core/registry.js');
    await openCustomImplEditor('freqDist', { op: getOp('freqDist'), onTest: (code, done) => { window.finishCustomFixture = done; } });
  });
  await fixture('return input;'); await content().press('Control+Enter');
  check(await page.locator('.ci-foot .btn-filled').isDisabled(), 'in-flight test blocks duplicate execution');
  await content().pressSequentially(' '); await page.evaluate(() => window.finishCustomFixture({ ok: false, line: 1, error: 'obsolete error' }));
  check(!(await page.locator('.ci-status-message').textContent()).includes('obsolete error'), 'late result cannot attach an error to edited code');
  await content().press('Control+Enter'); await page.locator('.ci-header-close').click();
  await page.evaluate(() => window.finishCustomFixture({ ok: true, out: 'late output' })); await settle();
  check(await page.locator('.ci-dialog').count() === 0, 'late test callback cannot revive a closed editor');

  stage = 'automatic source race';
  const racePage = await context.newPage(); racePage.on('pageerror', e => errors.push(e.message));
  await racePage.goto(new URL('#/op/rot13', base).href); await racePage.locator('#ioIn').waitFor();
  const sourceURL = await racePage.evaluate(async () => (await import('./src/core/registry.js')).getOp('rot13').sourceFile);
  let releaseSource, startedSource;
  const sourceGate = new Promise(resolve => { releaseSource = resolve; }), sourceStarted = new Promise(resolve => { startedSource = resolve; });
  await racePage.route(new URL(sourceURL, base).href, async route => { startedSource(); await sourceGate; await route.continue(); });
  await racePage.locator('.ci-edit-btn').click(); await sourceStarted;
  const keptEntry = await racePage.locator('.ci-editor-wrap .cm-content').evaluate(async node => {
    const { EditorView } = await import('./src/vendor/codemirror.bundle.js'); const view = EditorView.findFromDOM(node);
    const original = view.state.doc.toString(); view.dispatch({ changes: { from: 0, insert: '// user edit\n' }, userEvent: 'input' }); view.focus(); return original;
  });
  await racePage.locator('.ci-editor-wrap .cm-content').press('Control+z'); releaseSource();
  await racePage.waitForFunction(() => document.querySelector('.ci-status-message')?.textContent.includes('未覆盖代码'));
  check(await racePage.locator('.ci-editor-wrap .cm-content').evaluate(async node => {
    const { EditorView } = await import('./src/vendor/codemirror.bundle.js'); return EditorView.findFromDOM(node).state.doc.toString();
  }) === keptEntry, 'automatic load cannot overwrite an edit followed by undo to the initial text');
  await racePage.locator('.ci-header-close').click(); await racePage.close();

  stage = 'touch controls';
  const touch = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, serviceWorkers: 'block' });
  await touch.addInitScript(() => localStorage.setItem('ebctf_locale', 'zh'));
  const touchPage = await touch.newPage(); touchPage.on('pageerror', e => errors.push(e.message));
  await touchPage.goto(new URL('#/op/rot13', base).href); await touchPage.locator('.ci-edit-btn').click();
  await touchPage.locator('.ci-editor-wrap .cm-content').waitFor(); await touchPage.waitForTimeout(250);
  check(await touchPage.locator('.ci-dialog').evaluate(n => [...n.querySelectorAll('.ci-head .btn-icon,.ci-editor-toolbar .btn-icon,.ci-foot>.btn,.ci-editor-more>summary')]
    .every(b => b.getBoundingClientRect().width >= 44 && b.getBoundingClientRect().height >= 44)), 'touch actions meet the 44px target size');
  check(await touchPage.locator('.ci-dialog').evaluate(n => n.scrollWidth <= n.clientWidth + 1), 'touch toolbars fit without horizontal scrolling');
  await touchPage.locator('.ci-tools-toggle').click(); await touchPage.locator('.ci-panel').waitFor();
  await touchPage.locator('.ci-editor-wrap .cm-content').focus(); await touchPage.keyboard.press('Escape');
  check(await touchPage.locator('.ci-dialog').count() === 1 && !await touchPage.locator('.ci-panel').isVisible(), 'mobile Escape closes the helper drawer before the editor');
  await touchPage.close(); await touch.close();
  stage = 'style scope';
  await page.evaluate(() => { location.hash = '#/codeimg'; }); await page.locator('.ci-card').first().waitFor(); await settle();
  check(await page.locator('.ci-view > .ci-body').evaluate(n => getComputedStyle(n).flexDirection === 'row'
    && getComputedStyle(n.querySelector('.ci-tree')).flexDirection === 'column'), 'editor CSS does not change the restored code-image layout');
  check(errors.length === 0, `page errors: ${errors.join('; ')}`);
  console.log(JSON.stringify({ verdict: 'PASS', engine, checks, measurements, pageErrors: errors }));
} catch (error) { console.error(`Stage: ${stage}; pageerrors=${JSON.stringify(errors)}`); throw error; }
finally { await browser.close(); }
