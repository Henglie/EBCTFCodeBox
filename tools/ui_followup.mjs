import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { statSync } from "node:fs";
import { join } from "node:path";
const option = (name, fallback) => {
  const i = process.argv.indexOf(name);
  if (i < 0) return fallback;
  const value = process.argv[i + 1];
  assert(value && !value.startsWith("--"), `${name} requires a value`);
  return value;
};
if (process.argv.includes("--help")) {
  console.log("node tools/ui_followup.mjs [--base-url http://127.0.0.1:8180/] [--browser chromium|firefox|webkit] [--channel msedge] [--screenshots-dir <existing directory>]");
  process.exit(0);
}
const base = option("--base-url", "http://127.0.0.1:8180/");
const url = new URL(base);
assert(["http:", "https:"].includes(url.protocol) && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
  && !url.username && !url.password, "Use a local HTTP(S) test server without URL credentials");
const engine = option("--browser", "chromium");
assert(["chromium", "firefox", "webkit"].includes(engine), "Unknown browser engine");
const channel = option("--channel", undefined);
assert(!channel || engine === "chromium", "--channel requires --browser chromium");
const shots = option("--screenshots-dir", null);
if (shots) assert(statSync(shots).isDirectory(), "Screenshot directory must already exist");
const require = createRequire(import.meta.url);
const pw = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await pw[engine].launch({ headless: true, ...(channel ? { channel } : {}) });
let checks = 0;
const check = (condition, label) => { assert(condition, label); checks++; };
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: "zh-CN", serviceWorkers: "block" });
  await context.addInitScript(() => localStorage.setItem("ebctf_locale", "zh"));
  const page = await context.newPage();
  const errors = []; page.on("pageerror", error => errors.push(error.message));
  for (const id of ["freqDist", "trafficReadable", "entropy"]) {
    await page.goto(new URL(`#/op/${id}`, base).href);
    await page.locator(`#ci_enable_${id}`).waitFor({ state: "attached" });
    await page.locator("#ioIn").waitFor();
    check(await page.locator("#ioIn").isVisible(), `${id}: main input visible`);
    check(await page.locator(".io-none-hint").count() === 0, `${id}: no false no-input hint`);
  }
  await page.goto(new URL("#/op/freqDist", base).href);
  await page.locator("#ci_enable_freqDist").waitFor({ state: "attached" });
  await page.locator("#ioIn").fill("aab");
  await page.locator(".io-actions .act-btn.primary").click();
  await page.waitForFunction(() => /a/.test(document.getElementById("ioOut")?.textContent || "") && /2/.test(document.getElementById("ioOut")?.textContent || ""));
  check(true, "Frequency analysis consumes the actual input");

  await page.evaluate(() => {
    const area = document.getElementById("ioOut");
    const ctl = area.__ioCoding;
    ctl.reportWarnings(["按 gbk 猜测解码，置信度 0.900，理由：结构合法率 1.000（合法 3 字节 / 非法 0 字节）"]);
  });
  check(!/猜测解码|结构合法率|置信度/.test(await page.locator(".io-coding-status").allTextContents().then(lines => lines.join(" "))), "No guess diagnostics beside BOM");
  check(await page.locator('.io-coding-status[title*="置信度"]').count() === 0, "No guess diagnostics in the tooltip");

  await page.locator(".ci-edit-btn").click();
  await page.locator(".ci-dialog .cm-content").first().waitFor();
  await page.waitForTimeout(700);
  const dimensions = await page.evaluate(() => {
    const editor = document.querySelector(".ci-editor-wrap").getBoundingClientRect();
    const dialog = document.querySelector(".ci-dialog").getBoundingClientRect();
    const head = document.querySelector(".ci-dialog .ci-head").getBoundingClientRect();
    const foot = document.querySelector(".ci-dialog .ci-foot").getBoundingClientRect();
    return { editorHeight: editor.height, dialogHeight: dialog.height, headHeight: head.height, footHeight: foot.height };
  });
  check(dimensions.editorHeight / dimensions.dialogHeight > .7, `Editor owns the canvas: ${JSON.stringify(dimensions)}`);
  check(await page.locator(".ci-panel").isVisible() === false, "Helpers do not consume the initial editor canvas");
  check(await page.locator(".ci-spanel").isVisible() === false, "Source comparison is optional");
  check(await page.locator(".ci-group").evaluate(node => getComputedStyle(node).borderTopWidth === "0px"), "Custom implementation entry has no outline");
  await page.locator(".ci-tools-toggle").click();
  check(await page.locator(".ci-panel").isVisible(), "Helper panel remains available");
  await page.locator(".ci-tools-toggle").click();
  await page.locator(".ci-src-head-toggle").click();
  check(await page.locator(".ci-spanel").isVisible(), "Source comparison remains available");
  await page.locator(".ci-src-head-toggle").click();
  if (shots) await page.screenshot({ path: join(shots, `ui-followup-${engine}-editor-desktop.png`) });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(350);
  check(await page.locator(".ci-dialog").evaluate(node => node.scrollWidth <= node.clientWidth + 1), "Mobile editor has no horizontal overflow");
  if (shots) await page.screenshot({ path: join(shots, `ui-followup-${engine}-editor-mobile.png`) });
  await page.locator(".ci-header-close").click();
  await page.locator(".ci-dialog").waitFor({ state: "detached" });
  check(await page.locator("[inert]").count() === 0, "Closing the editor releases modal isolation");
  check(errors.length === 0, `Page errors: ${errors.join("; ")}`);
  console.log(JSON.stringify({ verdict: "PASS", browser: engine, channel: channel || null, checks, dimensions, pageErrors: errors }));
} finally { await browser.close(); }
