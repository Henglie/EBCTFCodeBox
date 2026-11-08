import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join } from "node:path";
const require = createRequire(import.meta.url);
const pw = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const option = (key, fallback) => process.argv.includes(key) ? process.argv[process.argv.indexOf(key) + 1] : fallback;
const engine = option("--browser", "chromium"), channel = option("--channel", undefined);
const base = option("--base-url", "http://127.0.0.1:8180/");
const shots = option("--screenshots-dir", undefined);
assert(["localhost", "127.0.0.1", "[::1]"].includes(new URL(base).hostname));
const executablePath = option("--executable-path", undefined);
const browser = await pw[engine].launch({ headless: true, ...(channel ? { channel } : {}), ...(executablePath ? { executablePath } : {}) });
let checks = 0;
const check = (value, label) => { assert(value, label); checks++; };
const context = await browser.newContext({ viewport: { width: 1366, height: 768 }, serviceWorkers: "block" });
const bridgeUnavailable = route => route.fulfill({ status: 503, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*", "Cross-Origin-Resource-Policy": "cross-origin" }, body: '{"error":"bridge unavailable in frontend test"}' });
await context.route(/^https?:\/\/(?:127\.0\.0\.1|localhost):8181\//, bridgeUnavailable);
await context.addInitScript(() => localStorage.setItem("ebctf_locale", "zh"));
const page = await context.newPage(), errors = [];
page.on("pageerror", e => errors.push(e.message));
let navigation = 0;
const go = async id => { await page.goto(new URL(`?feedback-check=${++navigation}#/op/${id}`, base).href, { waitUntil: "domcontentloaded" }); await page.locator(".op-feedback").waitFor(); };
const state = async expected => { await page.locator(`.op-feedback[data-state="${expected}"]`).waitFor(); checks++; };
try {
  await go("rot13");
  check(await page.locator('#ioIn[role="textbox"][aria-multiline="true"][aria-label="输入"]').count() === 1, "Named multiline input");
  check(await page.locator('#ioOut[role="textbox"][aria-readonly="true"][tabindex="0"][aria-label="输出"]').count() === 1, "Keyboard-readable output");
  await page.locator("#ioOut").focus(); await page.keyboard.press("Shift+Tab");
  check(!await page.locator("#ioOut").evaluate(n => n === document.activeElement), "Output participates in tab order");
  await page.locator("#ioIn").fill("uryyb");
  await page.locator(".io-actions .primary").click(); await state("success");
  check(await page.locator("#ioOut").textContent() === "hello", "Actual ROT13 output");
  await page.locator("#ioOut").focus(); await page.keyboard.type("x");
  check(await page.locator("#ioOut").textContent() === "hello", "Readonly output cannot be changed by typing");
  check(await page.locator('#ioIn').textContent() === 'uryyb', 'Typing in readonly output cannot change the previous input selection');
  check(await page.locator('#ioOut[aria-busy="false"][aria-invalid="false"]').count() === 1, "Completed state semantics");
  const liveMessage = await page.locator('.op-feedback [role="status"][aria-live="polite"]').textContent();
  check(liveMessage === "已完成", `Compact live announcement: ${liveMessage}; ${await page.locator('#ioIn').textContent()}`);
  check(!await page.locator("#ioOut").getAttribute("aria-live"), "Never announce entire output");
  await page.locator('.io-pane-input button[title="清空"]').click(); await state("idle");
  await go("chacha20Poly1305");
  for (const theme of ["light", "dark"]) {
    await page.evaluate(theme => window.__ebctfToggleTheme(theme), theme);
    for (const width of [1366, 1024, 600, 390, 320]) {
      await page.setViewportSize({ width, height: 768 }); await page.waitForTimeout(350);
      const layout = await page.evaluate(() => ({
        overflow: document.getElementById("workspace").scrollWidth > document.getElementById("workspace").clientWidth + 1,
        fields: [...document.querySelectorAll(".op-config .secret-field")].map(shell => {
          const a = shell.getBoundingClientRect(), b = shell.querySelector(".secret-eye-btn").getBoundingClientRect();
          return { gap: document.dir === "rtl" ? b.left - a.left : a.right - b.right, width: a.width, eye: b.width };
        }),
      }));
      check(!layout.overflow, `${theme}/${width}: no overflow`);
      check(layout.fields.length >= 2 && layout.fields.every(f => f.gap >= 0 && f.gap < 12), `${theme}/${width}: trailing reveal buttons ${JSON.stringify(layout)}`);
    }
    await page.setViewportSize({ width: 1366, height: 768 });
    if (shots) await page.screenshot({ path: join(shots, `feedback-${engine}-desktop-${theme}.png`) });
  }
  await page.locator("#p_nonce").fill("070000004041424344454647");
  const before = await page.locator("#p_nonce").inputValue();
  const eye = page.locator("#p_nonce").locator("..").locator(".secret-eye-btn");
  const pressed = await eye.getAttribute("aria-pressed");
  await eye.click(); check(await eye.getAttribute("aria-pressed") !== pressed, "Reveal toggles mask");
  check(await page.locator("#p_nonce").inputValue() === before, "Reveal preserves value");
  await page.locator("#ioIn").fill("00"); await page.locator(".io-actions .primary").click(); await state("error");
  check(await page.locator('#ioOut[aria-invalid="true"]').count() === 1, "Invalid output semantics");
  await page.waitForTimeout(250); await page.reload(); await state("error");
  check(await page.locator('#ioOut[aria-invalid="true"]').count() === 1, "Restored error keeps matching status");
  await go("pbkdf2");
  await page.locator("#ioIn").fill("password"); await page.locator("#p_iterations").fill("1000000");
  await page.waitForTimeout(350); await state("pending");
  await page.locator(".io-actions .primary").click(); await state("running");
  check(await page.locator(".io-actions .primary").isDisabled(), "Run cannot enqueue duplicates");
  check(await page.locator('#ioOut[aria-busy="true"]').count() === 1, "Busy semantics");
  await page.locator(".op-feedback-cancel").click(); await state("cancelled");
  check(!await page.locator(".io-actions .primary").isDisabled(), "Cancel restores run");
  check(await page.locator(".io-actions .primary").evaluate(n => n === document.activeElement), "Cancel restores keyboard focus");
  await page.locator("#p_iterations").fill("1"); await page.waitForTimeout(350);
  await page.locator(".io-actions .primary").click(); await state("success");
  check((await page.locator("#ioOut").textContent()).length === 64, "Actual Worker completion after cancel");
  await page.locator("#p_iterations").fill("1000000"); await page.waitForTimeout(350);
  await page.locator(".io-actions .primary").click(); await state("running");
  await page.locator('.io-pane-input button[title="清空"]').click(); await state("idle");
  await page.waitForTimeout(500);
  check(await page.locator("#ioOut").textContent() === "", "Clear invalidates late Worker result");
  check(!await page.locator(".io-actions .primary").isDisabled(), "Clear releases run control");
  await page.goto(new URL("#/about", base).href); await page.getByText("Jason", { exact: true }).waitFor();
  check(await page.getByText("提出增加国密攻击工具", { exact: true }).count() === 1, "Jason contribution is visible");
  const touch = await browser.newContext({ viewport: { width: 320, height: 800 }, hasTouch: true, serviceWorkers: "block" });
  await touch.route(/^https?:\/\/(?:127\.0\.0\.1|localhost):8181\//, bridgeUnavailable);
  await touch.addInitScript(() => localStorage.setItem("ebctf_locale", "zh"));
  const mobile = await touch.newPage();
  mobile.on("pageerror", e => errors.push(e.message));
  await mobile.goto(new URL("#/op/chacha20Poly1305", base).href); await mobile.locator(".op-feedback").waitFor();
  await mobile.waitForTimeout(500);
  check(await mobile.locator(".io-pane-input .io-pane-tools > .tool-btn:visible").count() === 3, "Touch toolbar has room for its label");
  check(await mobile.locator(".io-pane-input .io-pane-tools > .tool-btn:visible").evaluateAll(nodes => nodes.every(n => n.getBoundingClientRect().width >= 44 && n.getBoundingClientRect().height >= 44)), "44px touch targets");
  await mobile.locator(".io-pane-input .io-tools-more summary").click();
  check(await mobile.locator(".io-touch-tool:visible").count() === 2, "Undo/redo available in touch menu");
  check(await mobile.evaluate(() => { const n = document.getElementById("workspace"); return n.scrollWidth <= n.clientWidth + 1; }), "320px touch layout no overflow");
  if (shots) for (const theme of ["light", "dark"]) {
    await mobile.evaluate(theme => window.__ebctfToggleTheme(theme), theme);
    await mobile.locator(".io-pane-input .io-tools-more summary").evaluate(n => n.parentElement.open = false);
    await mobile.screenshot({ path: join(shots, `feedback-${engine}-mobile-${theme}.png`) });
  }
  await touch.close();
  check(errors.length === 0, `No page errors: ${errors.join("; ")}`);
  console.log(JSON.stringify({ engine, checks, pageErrors: errors.length, verdict: "PASS" }));
} catch (error) {
  console.error(await page.locator("#ioOut").textContent().catch(() => ""));
  throw error;
} finally { await context.close(); await browser.close(); }
