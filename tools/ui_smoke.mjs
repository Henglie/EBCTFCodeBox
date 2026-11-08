// Run against a local static server. Playwright is a development-only dependency.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { statSync } from "node:fs";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const pw = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const option = (key, fallback) => {
  const i = process.argv.indexOf(key);
  return i < 0 ? fallback : process.argv[i + 1];
};
const base = option("--base-url", "http://127.0.0.1:8180/");
assert(["localhost", "127.0.0.1", "[::1]"].includes(new URL(base).hostname), "Use a local test server");
const engine = option("--browser", "chromium");
assert(["chromium", "firefox", "webkit"].includes(engine));
const channel = option("--channel", undefined);
const shots = option("--screenshots-dir", undefined);
if (shots) assert(statSync(shots).isDirectory(), "Screenshot directory must already exist");
let checks = 0;
const check = (condition, label) => { assert(condition, label); checks++; };

// Development translations focus on zh/en; other locales align before release.
const dict = async name => (await import(`../src/i18n/${name}.js`)).default;
const zh = { ...await dict("zh"), ...await dict("desc_supplement_zh") };
for (const name of ["en", "locales/fr", "locales/ja", "locales/ko", "locales/ru"]) {
  const messages = { ...await dict(name), ...(name === "en" ? await dict("desc_supplement_en") : {}) };
  if (name === "en") check(JSON.stringify(Object.keys(messages).sort()) === JSON.stringify(Object.keys(zh).sort()), `${name}: key parity`);
  else check(Object.keys(messages).every(key => key in zh), `${name}: no unknown keys`);
  check(Object.keys(zh).filter(key => key.startsWith("ui.home.") || key === "ui.topbar.more")
    .every(key => typeof messages[key] === "string" && messages[key].length > 0), `${name}: home messages`);
}
const { PACKS } = await import("../src/core/offlinePacks.js");
const locales = PACKS.find(pack => pack.id === "locales");
let localeBytes = 0;
for (const entry of locales.entries) {
  const bytes = statSync(new URL(`..${entry.name}`, import.meta.url)).size;
  check(bytes === entry.bytes, `Offline pack byte size: ${entry.name} (${bytes} != ${entry.bytes})`);
  localeBytes += bytes;
}
check(localeBytes === locales.bytes, "Offline locale pack total");

const browser = await pw[engine].launch({ headless: true, ...(channel ? { channel } : {}) });
const errors = [];
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: "zh-CN", serviceWorkers: "block" });
await context.addInitScript(() => localStorage.setItem("ebctf_locale", "zh"));
const page = await context.newPage();
page.on("pageerror", error => errors.push(error.message));
const go = async (route, selector) => {
  await page.goto(new URL(`#/${route}`, base).href);
  await page.locator(selector).first().waitFor();
};
const layout = async label => {
  await page.waitForTimeout(300); // Wait for breakpoint / drawer transitions.
  const sizes = await page.evaluate(() => {
    const ws = document.getElementById("workspace");
    return { width: innerWidth, document: document.documentElement.scrollWidth, workspace: ws.scrollWidth, client: ws.clientWidth };
  });
  check(sizes.document <= sizes.width + 1, `${label}: document overflow ${JSON.stringify(sizes)}`);
  check(sizes.workspace <= sizes.client + 1, `${label}: workspace overflow ${JSON.stringify(sizes)}`);
};
const screenshot = async name => {
  if (shots) {
    await page.waitForTimeout(350);
    await page.screenshot({ path: join(shots, `ui-${engine}-${name}.png`) });
  }
};
const contrastResults = [];
const contrast = async (selector, foregroundProperty = "color") => page.locator(selector).first().evaluate(async (node, property) => {
  const { setupContinuousCorners } = await import(new URL("src/ui/continuousCorners.js", document.baseURI).href);
  const corners = setupContinuousCorners();
  const canvas = document.createElement("canvas"); canvas.width = canvas.height = 1;
  const ctx = canvas.getContext("2d");
  const rgba = color => {
    ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1);
    return [...ctx.getImageData(0, 0, 1, 1).data];
  };
  const blend = (fg, bg) => fg.slice(0, 3).map((value, i) => value * fg[3] / 255 + bg[i] * (1 - fg[3] / 255));
  const parents = []; for (let parent = node; parent; parent = parent.parentElement) parents.unshift(parent);
  let bg = [255, 255, 255];
  for (const parent of parents) bg = blend(rgba(corners.inspect(parent)?.applied
    ? corners.inspect(parent).source.background : getComputedStyle(parent).backgroundColor), bg);
  const color = getComputedStyle(node).getPropertyValue(property).trim();
  const fg = blend(rgba(color), bg);
  const luminance = rgb => rgb.map(value => value / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4)
    .reduce((sum, value, i) => sum + value * [.2126, .7152, .0722][i], 0);
  const a = luminance(fg), b = luminance(bg);
  return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
}, foregroundProperty);

try {
  await go("home", ".home-input");
  for (const width of [1440, 1024, 861, 860, 600, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await layout(`home-${width}`);
    check(await page.locator(".topbar").evaluate(node => Math.round(node.getBoundingClientRect().height) === 48), `Topbar-${width}: 48px`);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.waitForTimeout(300);
  const header = await page.evaluate(() => {
    const rect = selector => document.querySelector(selector).getBoundingClientRect();
    const update = rect("#btnUpdateLabel"), env = rect("#btnFontLabel"), version = rect("#appVer"), bar = rect(".topbar"), brand = rect("#brandTitle");
    return { labelOffset: Math.abs(update.top + update.height / 2 - env.top - env.height / 2),
      versionInside: version.bottom <= bar.bottom, versionParent: document.querySelector("#btnUpdate").contains(document.querySelector("#appVer")),
      brandOffset: Math.abs(brand.top + brand.height / 2 - bar.top - bar.height / 2) };
  });
  check(header.labelOffset <= 1 && header.brandOffset <= 1 && header.versionInside && header.versionParent, `Brand/update alignment: ${JSON.stringify(header)}`);
  check(await page.locator(".home-tool-card").count() === 4, "Four working home shortcuts");
  await screenshot("home-light");
  const curve = await page.locator(".home-studio").evaluate(async node => {
    const api = (await import(new URL("src/ui/continuousCorners.js", document.baseURI).href)).setupContinuousCorners();
    return { mode: api.mode, profile: api.stats().profile, applied: api.inspect(node)?.applied };
  });
  check(curve.applied && curve.profile === "apple-continuous-measured", "Shared Apple-style continuous profile applied");
  check(await page.locator(".magic-run").evaluate(async node => {
    const api = (await import(new URL('src/ui/continuousCorners.js', document.baseURI).href)).setupContinuousCorners();
    return !node.hasAttribute('data-cc-rendered') && api.inspect(node)?.reason === 'pill';
  }), "M3 full-round action retains its native capsule");

  // Composition commits must not start decoding. The regular Enter path must work.
  await page.locator(".home-input").fill("ZmxhZ3t1aV9zbW9rZX0=");
  await page.locator(".home-input").dispatchEvent("keydown", { key: "Enter", isComposing: true });
  check(await page.locator(".onekey-out").textContent() === "", "IME Enter does not decode");
  await page.locator(".home-input").press("Enter");
  await page.waitForFunction(() => document.querySelector(".onekey-out")?.textContent.includes("flag{ui_smoke}"), null, { timeout: 30000 });
  check(!await page.locator(".home-tools").isVisible(), "Results take priority over shortcuts");
  await page.locator('.home-editor-head button[title="清空"]').click();
  check(await page.locator(".home-input").textContent() === "", "Clear input");
  check(await page.locator(".onekey-out").textContent() === "", "Clear results");
  check(await page.locator(".home-studio").evaluate(node => getComputedStyle(node).borderTopWidth === "0px"), "Tonal studio has no decorative outline");
  check(await page.locator(".home-input").evaluate(node => parseFloat(getComputedStyle(node).borderTopWidth) > 0), "Editor keeps its closed boundary");

  for (const theme of ["light", "dark"]) {
    await page.evaluate(theme => window.__ebctfToggleTheme(theme), theme);
    await page.waitForTimeout(350);
    await page.locator(".batch-open").click();
    await page.locator(".batch-panel").waitFor();
    for (const selector of [".batch-panel", ".bp-sub", ".bp-drop", ".bp-table th", ".bp-row button:not(:disabled)"]) {
      const ratio = await contrast(selector);
      contrastResults.push({ theme, selector, ratio: +ratio.toFixed(2) });
      check(ratio >= 4.5, `${theme} batch ${selector}: contrast ${ratio}`);
    }
    await screenshot(`batch-${theme}`);
    await page.locator(".batch-dialog .exp-close").click();
    await page.locator(".batch-dialog").waitFor({ state: "detached" });
    await page.locator(".magic-strength-btn").click();
    await page.locator(".ds-slider").waitFor();
    const railRatio = await contrast(".ds-slider", "--range-track");
    contrastResults.push({ theme, selector: "slider-track", ratio: +railRatio.toFixed(2) });
    check(railRatio >= 3, `${theme} slider track contrast ${railRatio}`);
    await page.locator(".ds-slider").press("Home");
    for (let i = 0; i < 3; i++) await page.locator(".ds-slider").press("ArrowRight");
    check(await page.locator(".ds-slider").evaluate(node => node.style.getPropertyValue("--range-progress") === "60%"), "Slider active track follows its value");
    await screenshot(`slider-${theme}`);
    await page.locator(".ds-close").click();
    await page.locator(".ds-dialog").waitFor({ state: "detached" });
  }
  await page.evaluate(() => window.__ebctfToggleTheme("light"));
  await page.locator("#btnFont").click();
  await page.locator("#envMotionSpeed").selectOption("1.25");
  check(await page.evaluate(() => localStorage.getItem("ebctf.motionSpeed") === "1.25" && document.documentElement.dataset.motionSpeed === "1.25"), "Motion pace applies and persists");
  await page.locator("#envMotionSpeed").selectOption("1");
  await page.locator("#envMotionSpeed").focus();
  await page.keyboard.press("Escape");
  await page.locator(".env-panel").waitFor({ state: "detached" });

  // Keyboard search: selection, scroll, stale-close race and focus restoration.
  await page.locator(".home-input").focus();
  await page.keyboard.press("Control+k");
  const search = page.locator("#opSearchInput");
  check(await search.evaluate(node => node === document.activeElement), "Ctrl+K focuses search");
  await search.fill("base");
  await page.locator(".op-search-item").first().waitFor();
  await search.press("ArrowUp");
  check(await page.locator('.op-search-item[aria-selected="true"]').getAttribute("id") ===
    await page.locator(".op-search-item").last().getAttribute("id"), "ArrowUp starts at last result");
  await search.press("Escape");
  check(await page.locator(".home-input").evaluate(node => node === document.activeElement), "Escape restores editor focus");
  await search.fill("rot13");
  await page.locator(".op-search-item").first().waitFor();
  await search.press("ArrowDown");
  await search.press("Enter");
  await page.locator("#ioIn").waitFor();
  await page.locator("#ioIn").fill("uryyb");
  await page.locator(".io-actions .act-btn.primary").click();
  await page.waitForFunction(() => document.getElementById("ioOut")?.textContent === "hello");
  check(true, "Search selection and real ROT13 conversion");
  await layout("operation-desktop");
  await page.locator("#dirSeg.m3-segmented .m3-segment-thumb").waitFor();
  await page.locator("#dirSeg button.on").press("ArrowLeft");
  await page.waitForTimeout(500);
  check(await page.locator("#dirSeg").evaluate(node => {
    const selected = node.querySelector("button.on"), thumb = node.querySelector(".m3-segment-thumb");
    return selected.getAttribute("aria-pressed") === "true" && Math.abs(selected.getBoundingClientRect().left - thumb.getBoundingClientRect().left) < 1;
  }), "Shared segmented keyboard selection and indicator alignment");
  await screenshot("operation");

  for (const [route, selector] of [["all", ".allops-card"], ["recipe", ".recipe-bar"], ["inspect", ".uv-tabs"]]) {
    await go(route, selector);
    if (route === "all") {
      const firstCard = await page.locator(".allops-card").first().elementHandle();
      await page.locator(".allops-collapse-all").click();
      check(await page.locator('.allops-section-head[aria-expanded="true"]').count() === 0, "Collapse all categories");
      await page.locator(".allops-expand-all").click();
      check(await page.locator('.allops-section-head[aria-expanded="false"]').count() === 0, "Expand all categories");
      check(await page.evaluate(first => first === document.querySelector(".allops-card"), firstCard), "Bulk folding reuses cards");
      await page.locator(".allops-search-input").fill("base64");
      await page.locator(".allops-collapse-all").click();
      check(await page.locator(".allops-search-input").inputValue() === "base64", "Bulk folding preserves search");
      await page.locator(".allops-expand-all").click();
      await page.locator(".allops-search-input").fill("");
    }
    await layout(`${route}-desktop`);
    await screenshot(route);
    await page.setViewportSize({ width: 390, height: 844 });
    await layout(`${route}-mobile`);
    await page.setViewportSize({ width: 1440, height: 1000 });
  }

  await go("codeimg", ".ci-card");
  await page.locator(".ci-card").first().click();
  await page.locator(".ci-modal-dialog").waitFor();
  await page.waitForFunction(() => document.querySelector(".ci-modal-img")?.naturalWidth > 0);
  await page.locator('.ci-modal-dialog').evaluate(async node => {
    await Promise.all(node.getAnimations().filter(animation => Number.isFinite(animation.effect?.getComputedTiming().endTime))
      .map(animation => animation.finished.catch(() => {})));
  });
  await page.waitForTimeout(350);
  const viewer = await page.evaluate(() => ({
    stage: document.querySelector(".ci-modal-stage").getBoundingClientRect().height,
    viewport: innerHeight, head: document.querySelector(".ci-modal-head").getBoundingClientRect().height,
    foot: document.querySelector(".ci-modal-hint").getBoundingClientRect().height,
    background: getComputedStyle(document.querySelector(".ci-modal-dialog")).backgroundColor,
  }));
  check(viewer.stage >= viewer.viewport - 1 && viewer.head <= 72 && viewer.foot <= 56, `Compact viewer: ${JSON.stringify(viewer)}`);
  await page.locator('.ci-modal-tools button[aria-label="放大"]').click();
  check(await page.locator(".ci-modal-zoom").textContent() === "125%", "Viewer zoom controls");
  await page.locator(".ci-modal-zoom").click();
  check(await page.locator(".ci-modal-zoom").textContent() === "100%", "Viewer reset zoom");
  await screenshot("code-image-viewer");
  await page.setViewportSize({ width: 390, height: 844 });
  await screenshot("code-image-mobile");
  await page.locator(".ci-modal-close").click();
  await page.locator(".ci-modal-dialog").waitFor({ state: "detached" });
  await page.setViewportSize({ width: 1440, height: 1000 });

  await page.evaluate(async () => {
    const { openImageOpsViewer } = await import("./src/ui/imageOpsViewer.js");
    const canvas = document.createElement("canvas"); canvas.width = canvas.height = 16;
    canvas.getContext("2d").fillRect(0, 0, 16, 16);
    const viewer = openImageOpsViewer(canvas.toDataURL());
    await viewer.ready;
  });
  await page.locator('[data-imgops="more"]').click();
  await page.locator("#imgops-tab-color").click();
  await page.locator(".imgops-range.m3-slider").first().waitFor();
  check(await page.locator(".imgops-range.m3-slider").first().evaluate(node => {
    node.value = "25";
    return node.style.getPropertyValue("--range-progress") === "62.5%" && getComputedStyle(node).height === "44px";
  }), "Image adjustments use shared range geometry and programmatic synchronization");
  await page.locator(".imgops-close").click();
  await page.locator(".imgops-overlay").waitFor({ state: "detached" });

  await go("home", ".home-input");
  await page.evaluate(() => document.documentElement.classList.add("reduce-motion"));
  check(await page.locator(".home-tool-card").first().evaluate(node => parseFloat(getComputedStyle(node).transitionDuration) <= 0.001), "Reduced motion respected");
  await page.evaluate(() => {
    window.__ebctfToggleTheme("dark");
    document.documentElement.classList.remove("reduce-motion");
  });
  await page.waitForTimeout(350);
  await screenshot("home-dark");
  await page.setViewportSize({ width: 390, height: 844 });
  await layout("mobile-dark");
  await screenshot("home-mobile");
  await page.locator("#btnMoreActions").click();
  check(await page.locator("#topbarActions").isVisible(), "Mobile actions open");
  check(await page.locator("#btnAllOps").evaluate(node => node === document.activeElement), "Mobile action initial focus");
  for (const rect of await page.locator("#topbarActions > .icon-btn").evaluateAll(nodes => nodes.map(node => {
    const r = node.getBoundingClientRect(); return { id: node.id, width: r.width, height: r.height, right: r.right };
  }))) check(rect.width >= 44 && rect.height >= 44 && rect.right <= 390, `Touch target ${rect.id}`);
  await screenshot("mobile-actions");
  await page.keyboard.press("Escape");
  check(!await page.locator("#topbarActions").isVisible(), "Mobile action Escape closes");
  check(await page.locator("#btnMoreActions").evaluate(node => node === document.activeElement), "Mobile action focus restored");
  await page.locator(".nav-drawer-toggle").click();
  await page.locator(".sidenav.drawer-open").waitFor();
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  check(await page.locator("#sidenav").evaluate(node => node.inert), "Drawer closes independently");
  check(errors.length === 0, `Page errors: ${errors.join("; ")}`);

  if (process.argv.includes("--pwa")) {
    const offline = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: "zh-CN" });
    await offline.addInitScript(() => localStorage.setItem("ebctf_locale", "zh"));
    const tab = await offline.newPage();
    await tab.goto(new URL("#/home", base).href);
    await tab.evaluate(async () => { await navigator.serviceWorker.ready; });
    await tab.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 120000 });
    await tab.reload();
    await tab.locator(".home-studio").waitFor();
    await offline.setOffline(true);
    await tab.reload();
    await tab.locator(".home-studio").waitFor();
    check(await tab.locator(".home-studio").evaluate(node => getComputedStyle(node).borderRadius === "28px"), "PWA offline refinement CSS");
    await tab.goto(new URL("#/op/base64", base).href);
    await tab.locator(".op-workbench[data-layout='split']").waitFor();
    await tab.locator("#dirSeg button").first().click();
    await tab.locator("#ioIn").fill("offline");
    await tab.locator(".io-actions .act-btn.primary").click();
    await tab.waitForFunction(() => document.getElementById("ioOut")?.textContent === "b2ZmbGluZQ==");
    check(await tab.locator(".op-splitter").isVisible(), "PWA offline workbench, module and real conversion");
    await tab.setViewportSize({ width: 390, height: 844 });
    await tab.locator(".op-workbench[data-layout='stack']").waitFor();
    check(await tab.locator("#ioIn").textContent() === "offline", "PWA offline responsive layout preserves input");
    await tab.reload();
    await tab.locator("#ci_enable_base64").waitFor({ state: "attached" });
    check(await tab.locator("#ioIn").textContent() === "offline" && await tab.locator("#ioOut").textContent() === "b2ZmbGluZQ==", "PWA offline refresh restores both editor drafts");
    await tab.locator("#btnMoreActions").click();
    check(await tab.locator("#topbarActions").isVisible(), "PWA offline compact actions module");
    await offline.close();
  }
  console.log(JSON.stringify({ verdict: "PASS", browser: engine, checks, dictionaryKeys: Object.keys(zh).length, curve, contrastResults, pageErrors: errors }));
} finally {
  await browser.close();
}
