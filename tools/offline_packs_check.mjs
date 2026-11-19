import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { PACKS } from '../src/core/offlinePacks.js';

const option = (key, fallback) => process.argv.includes(key) ? process.argv[process.argv.indexOf(key) + 1] : fallback;
const base = new URL(option('--base-url', 'http://127.0.0.1:8180/'));
assert(['localhost', '127.0.0.1'].includes(base.hostname), 'Use a local test server');
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const channel = option('--channel');
const browser = await chromium.launch({ headless: true, ...(channel ? { channel } : {}) });
try {
  const context = await browser.newContext();
  await context.addInitScript(() => localStorage.setItem('ebctf_locale', 'zh'));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(new URL('#/plugins', base).href);
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 45_000 });
  await page.locator('[data-action="batch-cache"]').click();
  const result = page.locator('.ext-batch-result');
  await result.waitFor({ timeout: 120_000 });
  assert.match(await result.textContent(), new RegExp(`${PACKS.length} 个成功，0 个失败`));

  const packs = await page.evaluate(async () => {
    const names = (await caches.keys()).filter(name => name.startsWith('ebctf-pack-'));
    return Promise.all(names.map(async name => {
      const entries = await (await caches.open(name)).keys();
      return { id: name.replace(/^ebctf-pack-/, '').replace(/-[a-f0-9]+$/, ''), urls: entries.map(entry => entry.url) };
    }));
  });
  assert.equal(packs.length, PACKS.length);
  for (const pack of PACKS) {
    const expected = pack.entries.map(entry => new URL(entry.name.slice(1), base).href);
    assert.deepEqual(packs.find(item => item.id === pack.id)?.urls.sort(), expected.sort(), pack.id);
  }

  await context.setOffline(true);
  await page.reload();
  await page.locator('[data-action="batch-cache"]').waitFor();
  const offlineReads = await page.evaluate(async packs => Promise.all(packs.map(async ({ urls }) => {
    const res = await fetch(urls[0]);
    return res.ok && (await res.arrayBuffer()).byteLength > 0;
  })), packs);
  assert(offlineReads.every(Boolean), 'One real offline fetch succeeds from each pack');
  assert.deepEqual(errors, [], 'No browser exceptions');
  console.log(JSON.stringify({ verdict: 'PASS', packs: packs.length, cachedEntries: packs.reduce((sum, pack) => sum + pack.urls.length, 0), offlineReads: offlineReads.length }));
} finally {
  await browser.close();
}
