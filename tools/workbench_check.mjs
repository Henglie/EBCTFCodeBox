// Local-server integration checks. No server, bridge process or heavy attack is started here.
// PLAYWRIGHT_MODULE uses the same development-only fallback as tools/ui_smoke.mjs.
// --self-test validates fixtures and the real registry without Playwright or a server.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const option = (key, fallback) => {
  const i = process.argv.indexOf(key);
  if (i < 0) return fallback;
  const value = process.argv[i + 1];
  assert(value && !value.startsWith("--"), `${key} requires a value`);
  return value;
};
if (process.argv.includes("--help")) {
  console.log("node tools/workbench_check.mjs [--self-test|--editor-only|--family-only] [--base-url http://127.0.0.1:8180/] [--browser chromium|firefox|webkit] [--channel msedge] [--screenshots-dir <existing directory>] [--filter <case regex>] [--json]");
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
const shots = option("--screenshots-dir", undefined);
if (shots) assert(statSync(shots).isDirectory(), "Screenshot directory must already exist");
const filter = option("--filter", undefined);
const selected = filter ? new RegExp(filter) : null;

// Source freeze evidence: a concurrent main edit invalidates this run instead of becoming a UI failure.
const editorOnly = process.argv.includes("--editor-only");
const familyOnly = process.argv.includes("--family-only");
const sourcePaths = familyOnly ? ["src/ui/familyOverflow.js", "src/ui/familyOverflow.css", "src/ui/sharedControls.js"]
  : editorOnly ? ["src/ui/ioArea.js", "src/ui/editHistory.js", "src/core/historyStack.js"]
  : ["src/core/registry.js", "src/main.js", "src/ui/opWorkbench.js", "src/ui/opWorkbench.css", "src/ui/layoutPreferences.js", "src/ui/envPanel.js", "index.html", "src/i18n/zh.js", "src/i18n/en.js", "src/ui/ioArea.js", "src/ui/sharedControls.js", "src/ui/familyOverflow.js", "src/ui/familyOverflow.css"];
const fingerprint = () => Object.fromEntries(sourcePaths.map(path => {
  try { return [path, createHash("sha256").update(readFileSync(new URL(`../${path}`, import.meta.url))).digest("hex")]; }
  catch (error) { if (error.code === "ENOENT") return [path, null]; throw error; }
}));
const baseline = fingerprint();
const trafficIds = ["pcapParse", "pcapTcpReassemble", "pcapHttpExtract", "pcapDnsTunnel", "pcapIcmpPayload",
  "pcapFieldExtract", "httpDechunk", "trafficReadable", "ftpExtract", "tlsDecrypt", "wpaDecrypt", "pcapRepair"];
const specialOps = ["cryptoTryAll", "stegSolve", "jphswinLaunch", "openpuffLaunch", "oursecretLaunch"];
const nonOpPages = ["home", "all", "recipe", "exhaust", "inspect", "codeimg", "quickconv", "about", "plugins"];
const parameterOnlyExecuted = ["rsaEgcd", "rsaModinv"];
const uncovered = {
  specialLayoutDecisions: specialOps,
  nonOpLayoutDecisions: nonOpPages,
  trafficBrowserExecution: trafficIds.filter(id => id !== "trafficReadable"),
  usbBrowserExecution: ["usbKeyboard", "usbMouse"],
  multiFieldExecution: ["babaiCvp"],
  multiFieldChainPolicy: ["rsaCrt", "babaiCvp"],
  interactions: ["Firefox/WebKit native touch drag (trusted tap/capture covered; Playwright has no portable move API)", "browser zoom", "full offline PWA"],
  productDecisions: [], // Per-tool ratio persistence is covered by special_pages_check.
  artifacts: ["USB mouse track PNG", "USB keyboard rhythm PNG", "PCAPNG", "FTP files", "TLS/WPA decryption", "PCAP repair downloads"],
};

// Classic PCAP 2.4, LINKTYPE_ETHERNET, two IPv4/TCP PSH+ACK packets. Checksums are real.
// A fixed HTTP response carries the oracle; this is not a parser-generated empty/header-only fixture.
const flag = "flag{workbench_fixture}";
function checksum(bytes) {
  let sum = 0;
  for (let i = 0; i < bytes.length; i += 2) sum += (bytes[i] << 8) | (bytes[i + 1] || 0);
  while (sum >>> 16) sum = (sum & 0xffff) + (sum >>> 16);
  return (~sum) & 0xffff;
}
function packet(text, response) {
  const payload = Buffer.from(text, "ascii");
  const src = response ? [10, 0, 0, 2] : [10, 0, 0, 1], dst = response ? [10, 0, 0, 1] : [10, 0, 0, 2];
  const ip = Buffer.alloc(20); ip[0] = 0x45; ip.writeUInt16BE(40 + payload.length, 2);
  ip.writeUInt16BE(response ? 2 : 1, 4); ip[8] = 64; ip[9] = 6;
  ip.set(src, 12); ip.set(dst, 16); ip.writeUInt16BE(checksum(ip), 10);
  const tcp = Buffer.alloc(20); tcp.writeUInt16BE(response ? 80 : 40000, 0); tcp.writeUInt16BE(response ? 40000 : 80, 2);
  tcp.writeUInt32BE(response ? 101 : 1, 4); tcp.writeUInt32BE(response ? 1 : 101, 8);
  tcp[12] = 0x50; tcp[13] = 0x18; tcp.writeUInt16BE(4096, 14);
  const pseudo = Buffer.from([...src, ...dst, 0, 6, (20 + payload.length) >> 8, (20 + payload.length) & 255]);
  tcp.writeUInt16BE(checksum(Buffer.concat([pseudo, tcp, payload])), 16);
  return Buffer.concat([Buffer.from("0200000000020200000000010800", "hex"), ip, tcp, payload]);
}
function pcapFixture() {
  const head = Buffer.alloc(24); head.writeUInt32LE(0xa1b2c3d4, 0); head.writeUInt16LE(2, 4); head.writeUInt16LE(4, 6);
  head.writeUInt32LE(65535, 16); head.writeUInt32LE(1, 20);
  const frames = [packet("GET /audit HTTP/1.1\r\nHost: workbench.invalid\r\n\r\n", false),
    packet(`HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: ${flag.length}\r\nConnection: close\r\n\r\n${flag}`, true)];
  return Buffer.concat([head, ...frames.flatMap((frame, i) => {
    const record = Buffer.alloc(16); record.writeUInt32LE(1700000000 + i, 0);
    record.writeUInt32LE(frame.length, 8); record.writeUInt32LE(frame.length, 12);
    return [record, frame];
  })]);
}
const fixture = pcapFixture();

if (process.argv.includes("--self-test")) {
  const { OPS, getOp, inferIoMode, defaultParams } = await import("../src/core/registry.js");
  await import("../src/core/registerAll.js");
  const { parsePcapContainer } = await import("../src/core/pcapParse.js");
  const parsed = parsePcapContainer(new Uint8Array(fixture));
  assert.equal(parsed.packets.length, 2, "Fixture has two actual packets");
  const resultText = value => typeof value === "object" ? value.text : value;
  for (const id of trafficIds) {
    const op = getOp(id); assert(op, `${id} registered`);
    assert.equal(inferIoMode(op), "text", `${id}: text/file target retained`);
  }
  for (const id of ["trafficReadable", "pcapTcpReassemble", "pcapHttpExtract"]) {
    const op = getOp(id), p = defaultParams(op);
    const text = resultText(await op.run(fixture.toString("hex"), p));
    const raw = resultText(await op.run("file placeholder", { ...p, rawBytes: new Uint8Array(fixture) }));
    assert(text.includes(flag) && raw.includes(flag), `${id}: fixture payload survives text and raw bytes`);
  }
  const readable = getOp("trafficReadable");
  assert(resultText(await readable.run(fixture.toString("base64"), defaultParams(readable))).includes(flag), "Traffic base64 fixture");
  assert.equal(inferIoMode(getOp("rsaEgcd")), "none", "Parameter-only operation has no main input");
  const modinv = getOp("rsaModinv");
  assert.equal(modinv.io, "none", "Dual-direction parameter-only operation has explicit no-input metadata");
  assert.equal(inferIoMode(modinv), "none", "Dual-direction parameter-only operation has no main input");
  for (const dir of ["encode", "decode"]) assert.equal(await modinv[dir]("", { a: "3", m: "11" }), "4", `rsaModinv ${dir}: 3^-1 mod 11 = 4 without main input`);
  const egcd = getOp("rsaEgcd").run("", { a: "30", b: "18" });
  assert.match(egcd, /gcd\(a, b\) = 6/);
  assert.match(getOp("rsaCrt").run("2, 3, 2\n3, 5, 7"), /x = 23/);
  assert.match(getOp("freqDist").run("aab", defaultParams(getOp("freqDist"))), /a\t2\t66\.67%/);
  const noMainInput = OPS.filter(op => !op.requiresBridge && op.id !== "stegSolve" && inferIoMode(op) === "none").map(op => op.id);
  const noMainInputNotExecuted = noMainInput.filter(id => !parameterOnlyExecuted.includes(id));
  const inventory = {
    traffic: trafficIds.map(id => { const op = getOp(id); return { id, fields: op.fields || [], params: op.params.map(p => p.key) }; }),
    usbTextOnly: ["usbKeyboard", "usbMouse"],
    multiField: OPS.filter(op => op.fields?.length).map(op => ({ id: op.id, fields: op.fields.map(f => f.key), join: op.fieldsJoin })),
    noMainInput, noMainInputCount: noMainInput.length,
    noMainInputNotExecuted, noMainInputNotExecutedCount: noMainInputNotExecuted.length,
    specialOps, nonOpPages,
  };
  console.log(JSON.stringify({ verdict: "PASS", scope: "fixtures-and-registry-only", fixtureBytes: fixture.length,
    fixtureSha256: createHash("sha256").update(fixture).digest("hex"), inventory, uncovered, baseline }));
  process.exit(0);
}

const require = createRequire(import.meta.url);
const pw = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await pw[engine].launch({ headless: true, ...(channel ? { channel } : {}) });
let checks = 0;
const cases = [], errors = [], consoleErrors = [], failedRequests = [], geometry = [], editorEvidence = [], screenshots = new Set();
const check = (condition, label) => { assert(condition, label); checks++; };
try {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, locale: "zh-CN", serviceWorkers: "block", acceptDownloads: true });
  await context.addInitScript(() => localStorage.setItem("ebctf_locale", "zh"));
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on("pageerror", error => errors.push({ url: page.url(), message: error.message }));
  page.on("console", message => { if (message.type() === "error") consoleErrors.push({ url: page.url(), message: message.text() }); });
  page.on("requestfailed", request => failedRequests.push({ url: request.url(), error: request.failure()?.errorText }));
  const run = async (name, fn) => {
    if (selected && !selected.test(name) && name !== "browser events and source freeze") return;
    const start = checks;
    try { await fn(); cases.push({ name, verdict: "PASS", checks: checks - start }); }
    catch (error) {
      const diagnostic = await page.evaluate(() => {
        const ws = document.getElementById("workspace"), edge = ws?.getBoundingClientRect().right;
        return {
          output: document.getElementById("ioOut")?.value?.slice(0, 500),
          input: document.getElementById("ioIn")?.value?.slice(0, 150),
          focus: document.activeElement ? { tag: document.activeElement.tagName, id: document.activeElement.id, class: document.activeElement.className,
            label: document.activeElement.getAttribute("aria-label"), text: document.activeElement.textContent?.slice(0, 80) } : null,
          inputFont: document.getElementById("ioIn") ? { inline: document.getElementById("ioIn").style.fontSize, computed: getComputedStyle(document.getElementById("ioIn")).fontSize } : null,
          editor: document.getElementById("workbench-editor") ? { value: document.getElementById("workbench-editor").value,
            html: document.getElementById("workbench-editor").innerHTML, anchorNode: getSelection()?.anchorNode?.nodeName,
            anchorText: getSelection()?.anchorNode?.textContent, anchorOffset: getSelection()?.anchorOffset } : null,
          fields: [...document.querySelectorAll(".io-field-area")].map(node => ({ id: node.id, value: node.value, html: node.innerHTML })),
          overflow: ws ? [...ws.querySelectorAll("*")].map(node => ({ node: node.tagName + "." + node.className,
            right: node.getBoundingClientRect().right, width: node.getBoundingClientRect().width }))
            .filter(node => node.right > edge + 2 && node.width > 0).sort((a, b) => b.right - a.right).slice(0, 8) : [],
        };
      }).catch(() => null);
      cases.push({ name, verdict: "FAIL", checks: checks - start, error: error.message, url: page.url(), diagnostic });
    }
  };
  const go = async (route, selector = "#ioOut") => {
    await page.goto(new URL(`#/${route}`, base).href);
    const id = route.startsWith("op/") ? route.slice(3) : null;
    // A hash navigation can leave the old IO mounted while the next op module loads.
    if (id && !specialOps.includes(id)) await page.locator(`#ci_enable_${id}`).waitFor({ state: "attached" });
    await page.locator(selector).first().waitFor();
    await page.waitForTimeout(300); // Shared-control / workspace fade and ResizeObserver settle.
  };
  const read = selector => page.locator(selector).evaluate(node => node.value ?? node.textContent);
  const output = async (pattern, label = "result") => {
    try { await page.waitForFunction(source => new RegExp(source).test(document.getElementById("ioOut")?.value || ""), pattern.source); }
    catch { throw new Error(`${label}: expected ${pattern}, actual ${JSON.stringify((await read("#ioOut")).slice(0, 300))}`); }
    check(!await page.locator("#ioOut").evaluate(node => node.classList.contains("error")), "Result is not an error");
    return read("#ioOut");
  };
  const convert = () => page.locator(".io-actions .act-btn.primary").click();
  const action = name => page.locator(`.io-${name}`);
  const inputTool = name => page.locator(".io-pane").first().getByRole("button", { name, exact: true });
  const capture = async name => {
    if (shots) { const path = join(shots, `workbench-${engine}-${name}.png`); await page.screenshot({ path }); screenshots.add(path); }
  };
  const noOverflow = async label => {
    const sizes = await page.evaluate(() => {
      const ws = document.getElementById("workspace");
      return { viewport: innerWidth, document: document.documentElement.scrollWidth, workspace: ws.scrollWidth, client: ws.clientWidth };
    });
    check(sizes.document <= sizes.viewport + 2 && sizes.workspace <= sizes.client + 2, `${label}: no horizontal overflow ${JSON.stringify(sizes)}`);
  };
  const contract = async (label, expected, edu = false) => {
    if (edu) await page.locator("#workspace > .edu-card").waitFor();
    const result = await page.evaluate(() => {
      const ws = document.getElementById("workspace"), wb = ws.querySelector(".op-workbench");
      if (!wb) return { missing: "op-workbench" };
      const config = wb.querySelector(":scope > .op-config"), data = wb.querySelector(":scope > .op-data"), split = wb.querySelector(":scope > .op-splitter");
      if (!config || !data || !split) return { missing: "direct config/splitter/data" };
      const rect = node => { const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; };
      const io = data.querySelector(".io.io-vert"), panes = io?.querySelectorAll(":scope > .io-pane"), actions = io?.querySelector(":scope > .io-actions");
      const card = ws.querySelector(":scope > .edu-card"), output = document.getElementById("ioOut");
      const frames = io?.querySelectorAll(".io-editor-frame"), report = data.querySelector(".io-report");
      const heads = [...(io?.querySelectorAll(".io-pane-head") || [])];
      const outputCoding = panes?.[1]?.querySelector(".io-coding-bar");
      const direction = config.querySelector("#dirSeg");
      return { direct: wb.parentElement === ws, display: getComputedStyle(wb).display, direction: getComputedStyle(wb).direction, layout: wb.dataset.layout,
        ordered: config.nextElementSibling === split && split.nextElementSibling === data,
        controlsInside: [...ws.querySelectorAll(".op-head,.fam-seg,#dirSeg,.op-params,.ci-anchor,.rand-sec-host")].every(node => config.contains(node)),
        head: !!config.querySelector(".op-head"), io: !!io, paneCount: panes?.length || 0,
        noInput: wb.dataset.inputMode === 'none', inputHidden: !!panes?.[0]?.hidden,
        role: split.getAttribute("role"), orientation: split.getAttribute("aria-orientation"), focusable: split.tabIndex >= 0,
        name: split.getAttribute("aria-label") || split.getAttribute("aria-labelledby"),
        wb: rect(wb), config: rect(config), data: rect(data),
        frames: frames?.length || 0, inputFramed: !!ws.querySelector(".io-editor-frame #ioIn") || !ws.querySelector("#ioIn"),
        outputFramed: !!ws.querySelector(".io-editor-frame #ioOut"),
        toolsFramed: heads.length === 2 && heads.every(node => node.closest(".io-editor-frame") && getComputedStyle(node).position === "absolute"),
        fieldsFramed: [...(io?.querySelectorAll(".io-field-area") || [])].every(node => node.closest(".io-editor-frame")),
        reportOutsideActions: !!report && !actions?.contains(report),
        reportAfterOutput: !!report && !!output && !!(output.compareDocumentPosition(report) & Node.DOCUMENT_POSITION_FOLLOWING),
        reportBelowOutput: !!report && !!output && report.getBoundingClientRect().top >= output.getBoundingClientRect().bottom - 2,
        outputCodingAfterEditor: !outputCoding || !!(output?.compareDocumentPosition(outputCoding) & Node.DOCUMENT_POSITION_FOLLOWING),
        directionWidth: direction?.getBoundingClientRect().width,
        input: panes?.[0] ? rect(panes[0]) : null, output: panes?.[1] ? rect(panes[1]) : null, actions: actions ? rect(actions) : null,
        edu: card ? rect(card) : null, eduAfter: card ? !!(wb.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING) : false };
    });
    check(!result.missing, `${label}: ${result.missing}`);
    check(result.direct && result.display === "grid" && result.ordered, `${label}: workspace > grid(config, separator, data)`);
    check(result.head && result.controlsInside && result.io && result.paneCount === 2, `${label}: controls and existing vertical IO preserved`);
    check(result.role === "separator" && result.name && (expected !== "split" || (result.orientation === "vertical" && result.focusable)), `${label}: named separator, keyboard-accessible in split layout`);
    check((result.noInput ? result.inputHidden : result.output.y >= result.input.bottom - 2 && result.actions.y >= result.input.bottom - 2)
      && result.actions.bottom <= result.output.y + 2, `${label}: input / actions / output stay vertical`);
    check(result.frames === 2 && result.inputFramed && result.outputFramed && result.fieldsFramed && result.toolsFramed, `${label}: titles/tools live inside editor frames with absolute heads`);
    check(result.reportOutsideActions && result.reportAfterOutput && result.reportBelowOutput && result.outputCodingAfterEditor, `${label}: report/output coding follow the output editor`);
    if (result.directionWidth) check(result.directionWidth < result.config.width - 20, `${label}: direction control has intrinsic width instead of filling config`);
    if (expected === "split") check((result.direction === "rtl" ? result.config.x >= result.data.right - 2 : result.data.x >= result.config.right - 2)
      && Math.abs(result.data.y - result.config.y) <= 4, `${label}: split geometry`);
    if (expected === "stack") check(result.data.y >= result.config.bottom - 2, `${label}: stack geometry`);
    if (result.layout && expected) check(result.layout === expected, `${label}: data-layout agrees with geometry`);
    if (edu) check(result.edu && result.eduAfter && result.edu.y >= result.wb.bottom - 2
      && Math.abs(result.edu.x - result.wb.x) <= 3 && Math.abs(result.edu.width - result.wb.width) <= 3, `${label}: education is a full-span sibling after workbench`);
    geometry.push({ label, ...result });
    await noOverflow(label);
  };
  const report = async () => {
    const [download] = await Promise.all([page.waitForEvent("download"), action("report").click()]);
    const stream = await download.createReadStream();
    assert(stream, "Report download stream exists");
    const chunks = []; for await (const chunk of stream) chunks.push(chunk);
    const md = Buffer.concat(chunks).toString("utf8"), match = md.match(/```json\r?\n([\s\S]*?)\r?\n```/);
    check(!!match && download.suggestedFilename().endsWith(".md"), "Report is a real Markdown download with JSON");
    return JSON.parse(match[1]);
  };
  const parameter = async key => {
    // renderParam's p_<key> IDs are the existing application contract, not new layout internals.
    const locator = page.locator(`#p_${key}`);
    await locator.waitFor(); return locator;
  };

  if (familyOnly) {
    await page.setViewportSize({ width: 1600, height: 1000 }); await go("op/rsaModinv");
    await page.evaluate(async base => {
      const href = new URL("src/ui/familyOverflow.css", base).href;
      if (![...document.querySelectorAll('link[rel="stylesheet"]')].some(link => link.href === href)) {
        const link = document.createElement("link"); link.rel = "stylesheet"; link.href = href;
        await new Promise((resolve, reject) => { link.onload = resolve; link.onerror = reject; document.head.append(link); });
      }
    }, base);
    const family = page.locator("#workbench-family-fixture");
    const more = family.locator(".family-more");
    const menu = page.locator('body > .family-overflow-menu');
    const mountFamily = async (width = 640, rtl = false) => {
      await page.evaluate(async ({ base, width, rtl }) => {
        window.__familyFixture?.dispose(); document.getElementById("workbench-family-host")?.remove();
        const labels = [...document.querySelectorAll("#workspace .fam-seg > button:not([data-family-more])")].map(button => button.textContent.trim());
        const { attachFamilyOverflow } = await import(new URL("src/ui/familyOverflow.js", base).href);
        const { initSharedControls } = await import(new URL("src/ui/sharedControls.js", base).href); initSharedControls();
        const host = document.createElement("div"); host.id = "workbench-family-host";
        host.style.cssText = `position:fixed;z-index:9000;top:80px;left:16px;width:${width}px;max-width:calc(100vw - 32px);height:64px;overflow:auto;background:var(--surface)`;
        const root = document.createElement("div"); root.id = "workbench-family-fixture"; root.className = "dir-seg fam-seg";
        root.dir = rtl ? "rtl" : "ltr"; root.setAttribute("aria-label", "RSA algorithms"); root.dataset.segmentKey = "family:regression";
        const state = { root, labels, calls: [], contextCalls: 0, dispose: null };
        root.oncontextmenu = event => { event.preventDefault(); state.contextCalls++; };
        state.contextHandler = root.oncontextmenu;
        labels.forEach((text, index) => {
          const button = document.createElement("button"); button.type = "button"; button.textContent = text; button.dataset.choice = String(index);
          if (index === labels.length - 1) button.className = "on";
          button.addEventListener("click", () => {
            state.calls.push(index);
            for (const other of root.querySelectorAll("button:not([data-family-more])")) {
              other.classList.toggle("on", other === button); other.setAttribute("aria-pressed", String(other === button));
            }
          }); root.append(button);
        });
        const after = document.createElement("button"); after.id = "workbench-family-after"; after.textContent = "After family";
        host.append(root, after); document.body.append(host);
        state.dispose = attachFamilyOverflow(root, { moreLabel: "More algorithms", ariaLabel: "RSA algorithm choices" }); window.__familyFixture = state;
      }, { base, width, rtl });
      await more.waitFor(); await page.waitForTimeout(150);
    };
    const familyState = () => family.evaluate(root => {
      const buttons = [...root.querySelectorAll(":scope > button:not([data-family-more])")], visible = buttons.filter(button => !button.hidden);
      const more = root.querySelector(".family-more"), thumb = root.querySelector(".m3-segment-thumb");
      return { count: buttons.length, visible: visible.map(button => Number(button.dataset.choice)), hidden: buttons.filter(button => button.hidden).map(button => Number(button.dataset.choice)),
        overflow: root.scrollWidth - root.clientWidth, moreHidden: more.hidden, moreSelected: more.classList.contains("on"), label: more.textContent,
        selected: buttons.findIndex(button => button.classList.contains("on")), focused: document.activeElement?.getAttribute("data-choice"), moreFocused: document.activeElement === more,
        thumbWidth: thumb?.getBoundingClientRect().width, moreWidth: more.getBoundingClientRect().width };
    });
    await run("family: contiguous prefix, selected overflow and responsive measurement", async () => {
      await mountFamily(); const state = await familyState();
      check(state.count >= 9 && state.hidden.length > 0, "Real RSA family has enough choices to overflow");
      check(state.visible.every((index, i) => index === i) && state.hidden[0] === state.visible.length, "Visible choices are exactly the initial contiguous prefix");
      check(state.overflow <= 1 && await family.evaluate(root => getComputedStyle(root).overflowX === "hidden"), "Family never horizontally scrolls");
      check(state.moreSelected && state.label.includes(await page.evaluate(() => window.__familyFixture.labels.at(-1))), "Overflow launcher identifies the current hidden selection");
      check(Math.abs(state.thumbWidth - state.moreWidth) <= 1, "Selection thumb represents More, not a zero-width hidden operation");
      await page.evaluate(() => document.getElementById("workbench-family-host").style.maxWidth = "none");
      await page.evaluate(() => document.getElementById("workbench-family-host").style.width = "10000px");
      await more.waitFor({ state: "hidden" });
      check((await familyState()).hidden.length === 0, "Wider container restores all original buttons");
      await page.evaluate(() => { const host = document.getElementById("workbench-family-host"); host.style.width = "340px"; host.style.maxWidth = "calc(100vw - 32px)"; });
      await more.waitFor(); await page.waitForTimeout(150);
      check((await familyState()).overflow <= 1, "Narrow resize keeps the launcher within bounds");
      await page.waitForTimeout(200);
      await family.evaluate(root => { window.__familyMutations = 0; window.__familyMutationObserver = new MutationObserver(records => window.__familyMutations += records.length); window.__familyMutationObserver.observe(root, { attributes: true, childList: true, subtree: true }); });
      await page.waitForTimeout(250);
      check(await page.evaluate(() => window.__familyMutations < 8), "Shared-control and overflow observers settle without mutation churn");
      await page.evaluate(() => window.__familyMutationObserver.disconnect());
      check(await page.locator(".family-overflow-measure").count() === 0, "Inert measurement clones are removed");
    });
    await run("family: named body portal, keyboard navigation, Tab and Escape", async () => {
      await mountFamily(); await more.focus(); await more.press("Enter"); await menu.waitFor();
      check(await menu.getAttribute("role") === "menu" && await menu.getAttribute("aria-label") === "RSA algorithm choices", "Overflow is a named menu portal");
      check(await more.getAttribute("aria-expanded") === "true", "Launcher exposes expanded state");
      const items = menu.getByRole("menuitemradio");
      check(await items.count() === (await familyState()).hidden.length, "Drawer contains every overflow operation in order");
      check(await menu.locator('[aria-checked="true"]').count() === 1, "Current choice has a radio checked state");
      await page.keyboard.press("Home"); check(await items.first().evaluate(node => node === document.activeElement), "Home focuses the first menu choice");
      await page.keyboard.press("End"); check(await items.last().evaluate(node => node === document.activeElement), "End focuses the last menu choice");
      await page.keyboard.press("ArrowDown"); check(await items.first().evaluate(node => node === document.activeElement), "ArrowDown wraps within the menu without routing");
      await page.keyboard.press("ArrowUp"); check(await items.last().evaluate(node => node === document.activeElement), "ArrowUp wraps within the menu");
      check(await page.evaluate(() => window.__familyFixture.calls.length === 0), "Opening/navigating does not click an operation");
      await page.keyboard.press("Escape"); check(await menu.count() === 0 && await more.evaluate(node => node === document.activeElement), "Escape removes portal and restores launcher focus");
      await more.press("ArrowDown"); await menu.waitFor(); await page.keyboard.press("Tab");
      check(await menu.count() === 0 && await page.evaluate(() => document.activeElement?.isConnected && document.activeElement !== document.body), "Tab closes the portal and keeps document focus");
      const state = await familyState();
      check(state.visible.length > 0, "Fixture has a visible prefix for segmented keyboard navigation");
      await family.locator('button:not([data-family-more]):not([hidden])').last().focus(); await page.keyboard.press("ArrowRight");
      check(await more.evaluate(node => node === document.activeElement) && await menu.count() === 0, "Segment arrow reaching More only focuses it");
      check(await page.evaluate(() => window.__familyFixture.calls.length === 0), "Reaching the launcher does not route or open a drawer");
    });
    await run("family: changing labels, resize focus and explicit disposer", async () => {
      await mountFamily();
      const before = (await familyState()).visible.length;
      await family.locator('button:not([data-family-more])').first().evaluate(button => button.textContent = "Long responsive algorithm label ".repeat(5));
      await page.waitForTimeout(150);
      check((await familyState()).visible.length < before && (await familyState()).overflow <= 1, "A changed label is measured again without revealing or scrolling source buttons");
      await page.evaluate(() => { const host = document.getElementById("workbench-family-host"); host.style.maxWidth = "none"; host.style.width = "10000px"; });
      await more.waitFor({ state: "hidden" });
      await family.locator('button:not([data-family-more])').last().focus();
      await page.evaluate(() => document.getElementById("workbench-family-host").style.width = "340px");
      await more.waitFor(); await page.waitForTimeout(150);
      check(await more.evaluate(node => node === document.activeElement), "Resize transfers focus from a newly hidden operation to More");
      await more.click(); await menu.waitFor();
      await page.evaluate(() => window.__familyFixture.dispose());
      check(await menu.count() === 0 && await family.locator(".family-more").count() === 0, "Explicit disposer removes launcher and body menu");
      check(await family.locator('button.on').evaluate(node => node === document.activeElement && !node.hidden), "Disposal restores focus to the original selected operation");
      check(await page.evaluate(() => window.__familyFixture.root.oncontextmenu === window.__familyFixture.contextHandler), "Disposal preserves the original favorites callback");
    });
    await run("family: original click delegation, favorites, outside click and route close", async () => {
      await mountFamily(); await more.click(); await menu.waitFor();
      const expected = (await familyState()).hidden[0];
      await menu.getByRole("menuitemradio").first().click(); await page.waitForTimeout(150);
      check(await page.evaluate(expected => window.__familyFixture.calls.length === 1 && window.__familyFixture.calls[0] === expected, expected), "Choice calls its original button exactly once");
      check((await familyState()).selected === expected && await menu.count() === 0, "Original selection state is preserved");
      check(await page.evaluate(() => window.__familyFixture.root.oncontextmenu === window.__familyFixture.contextHandler), "Root favorites context handler is untouched");
      await more.click(); await menu.waitFor(); await menu.getByRole("menuitemradio").first().click({ button: "right" });
      check(await page.evaluate(() => window.__familyFixture.contextCalls === 1), "Portal right-click delegates to the existing family favorites handler");
      await more.click(); await menu.waitFor(); await page.mouse.click(1200, 900);
      check(await menu.count() === 0 && await more.getAttribute("aria-expanded") === "false", "Outside pointer closes the menu and resets ARIA");
      await more.click(); await menu.waitFor(); await family.locator('button:not([data-family-more]):not([hidden])').first().click();
      check(await menu.count() === 0, "Clicking another visible family control also dismisses the portal");
      await more.click(); await menu.waitFor(); await page.evaluate(() => location.hash = "#/about");
      await menu.waitFor({ state: "detached" }); check(await more.getAttribute("aria-expanded") === "false", "Actual hash navigation closes the retained portal");
    });
    await run("family: portrait/RTL viewport bounds and disposal", async () => {
      await go("op/rsaModinv"); await page.setViewportSize({ width: 390, height: 844 }); await mountFamily(300, true);
      await more.press("ArrowUp"); await menu.waitFor();
      const rect = await menu.boundingBox();
      check(rect.x >= 7 && rect.x + rect.width <= 383 && rect.y >= 7 && rect.y + rect.height <= 837, "RTL portal fits the portrait viewport");
      check(await menu.getAttribute("dir") === "rtl", "Portal inherits family direction outside its original parent");
      await page.keyboard.press("Escape");
      await page.evaluate(() => document.getElementById("workbench-family-host").style.width = "80px"); await page.waitForTimeout(150);
      check((await familyState()).overflow <= 1 && (await familyState()).visible.length === 0, "Tiny container uses only a bounded More launcher");
      await more.click(); await menu.waitFor();
      await family.evaluate(root => root.remove()); await menu.waitFor({ state: "detached" });
      check(await page.evaluate(() => [...window.__familyFixture.root.querySelectorAll('button:not([data-family-more])')].every(button => !button.hidden)), "Root removal disposes the portal and restores original button visibility");
      await page.evaluate(() => { window.__familyFixture.dispose(); window.__familyFixture.dispose(); document.getElementById("workbench-family-host").remove(); });
      check(await page.locator(".family-overflow-menu,.family-overflow-measure").count() === 0, "Disposal is idempotent and leaves no body portal or measuring nodes");
    });
  } else if (editorOnly) {
    await go("about", ".about-page");
    const moduleUrl = new URL("src/ui/ioArea.js", base).href;
    await run("editor: served production module matches the checked source", async () => {
      const response = await page.request.get(moduleUrl);
      check(response.ok(), "Production ioArea module is served");
      check(createHash("sha256").update(await response.body()).digest("hex") === baseline["src/ui/ioArea.js"], "Served module SHA256 matches the source file");
    });
    const editor = page.locator("#workbench-editor");
    const select = async (start, end = start) => editor.evaluate((area, offsets) => {
      area.focus();
      const find = offset => {
        const walker = document.createTreeWalker(area, NodeFilter.SHOW_TEXT);
        let node; while ((node = walker.nextNode())) { if (offset <= node.length) return [node, offset]; offset -= node.length; }
        return [area, area.childNodes.length];
      };
      const range = document.createRange(); range.setStart(...find(offsets[0])); range.setEnd(...find(offsets[1]));
      const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
    }, [start, end]);
    const reset = async (text = "", start = text.length, end = start, readonly = false) => {
      await page.evaluate(async ({ url, readonly }) => {
        const { ioArea } = await import(url);
        document.getElementById("workbench-editor-host")?.remove();
        const host = document.createElement("section"); host.id = "workbench-editor-host";
        host.style.cssText = "position:fixed;inset:70px 20px auto;z-index:20000;padding:16px;background:white;color:black";
        const area = ioArea({ id: "workbench-editor", class: "io-area", placeholder: "editor regression", readonly });
        area.style.cssText = "white-space:pre-wrap;min-height:180px;height:220px;font:18px monospace;color:black;background:white";
        const outside = document.createElement("div"); outside.id = "workbench-editor-outside"; outside.contentEditable = "true"; outside.textContent = "outside";
        host.append(area, outside); document.body.append(host);
      }, { url: moduleUrl, readonly });
      await editor.evaluate((area, text) => area.value = text, text);
      if (!readonly) await select(start, end);
    };
    const expectText = async (expected, label) => {
      const state = await editor.evaluate(area => ({ value: area.value, textContent: area.textContent, html: area.innerHTML,
        anchorNode: getSelection()?.anchorNode?.nodeName, anchorOffset: getSelection()?.anchorOffset }));
      check(state.value === expected, `${label}: ${JSON.stringify(state.value)} != ${JSON.stringify(expected)}`);
      check(state.textContent === expected, `${label}: textContent is exactly the data, without sentinel characters`);
      editorEvidence.push({ label, ...state });
    };
    const paste = text => editor.evaluate((area, text) => {
      const clipboardData = new DataTransfer(); clipboardData.setData("text/plain", text);
      const event = new Event("paste", { bubbles: true, cancelable: true });
      Object.defineProperty(event, "clipboardData", { value: clipboardData }); area.dispatchEvent(event);
    }, text);

    await run("editor: multiple Enter, blank lines, Shift+Enter and native typing", async () => {
      await reset("first"); await editor.press("Enter"); await expectText("first\n", "first Enter");
      await page.keyboard.type("second"); await expectText("first\nsecond", "typing after terminal LF");
      await editor.press("Enter"); await editor.press("Enter"); await page.keyboard.type("third");
      await expectText("first\nsecond\n\nthird", "consecutive Enter");
      await editor.press("Shift+Enter"); await page.keyboard.type("fourth");
      await expectText("first\nsecond\n\nthird\nfourth", "Shift+Enter");
    });
    await run("editor: Enter at start/middle/end and selection replacement", async () => {
      for (const [text, start, end, typed, expected] of [["abcd", 0, 0, "S", "\nSabcd"], ["abcd", 2, 2, "M", "ab\nMcd"],
        ["abcd", 4, 4, "E", "abcd\nE"], ["abcd", 1, 3, "R", "a\nRd"], ["ab\ncd\nef", 1, 7, "X", "a\nXf"]]) {
        await reset(text, start, end); await editor.press("Enter"); await page.keyboard.type(typed);
        await expectText(expected, `Enter replaces range ${start}:${end} in ${JSON.stringify(text)}`);
      }
    });
    await run("editor: beforeinput paragraph/line-break without keydown", async () => {
      for (const inputType of ["insertParagraph", "insertLineBreak"]) {
        await reset("a");
        const cancelled = await editor.evaluate((area, inputType) => !area.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType })), inputType);
        check(cancelled, `${inputType}: native block insertion is prevented`);
        await expectText("a\n", inputType); await page.keyboard.type("b"); await expectText("a\nb", `${inputType}: following text`);
      }
    });
    await run("editor: plain multiline paste, trailing LF, Unicode and stale selection", async () => {
      await reset("leftright", 4); await paste("\nA\nB\n"); await page.keyboard.type("x");
      await expectText("left\nA\nB\nxright", "paste in the middle");
      await reset("start"); await paste("\nline\n"); await expectText("start\nline\n", "paste ending in LF");
      await page.keyboard.type("tail"); await expectText("start\nline\ntail", "typing after pasted terminal LF");
      await reset("abcd", 1, 3); await paste("P\nQ"); await page.keyboard.type("!"); await expectText("aP\nQ!d", "paste replaces selection");
      await reset(); await paste("<b>x</b>\n\u4e2d\ud83d\ude42\n"); await page.keyboard.type("end");
      await expectText("<b>x</b>\n\u4e2d\ud83d\ude42\nend", "paste remains literal Unicode text");
      check(await editor.locator("b").count() === 0, "HTML in text/plain never becomes markup");
      await reset("inside");
      await page.locator("#workbench-editor-outside").evaluate(area => {
        const range = document.createRange(); range.selectNodeContents(area); const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
      });
      await paste("p\nq"); await expectText("insidep\nq", "stale selection appends inside the intended editor");
      check(await page.locator("#workbench-editor-outside").textContent() === "outside", "Paste cannot replace an unrelated editor's selection");
    });
    await run("editor: undo/redo restores terminal LF, selection and subsequent typing", async () => {
      await reset("base"); await editor.press("Enter"); await page.waitForTimeout(550); await page.keyboard.type("next");
      await editor.press("Control+z"); await expectText("base\n", "undo typing after Enter");
      await editor.press("Control+Shift+z"); await expectText("base\nnext", "redo typing");
      await editor.press("Control+z"); await page.keyboard.type("branch"); await expectText("base\nbranch", "type at caret restored after terminal LF");
      await editor.press("Control+z"); await expectText("base\n", "undo branch");
      await editor.press("Control+y"); await expectText("base\nbranch", "Ctrl+Y redo");
      await reset("base"); await paste("A\n"); await editor.press("Control+z"); await expectText("base", "undo paste");
      await editor.press("Control+Shift+z"); await expectText("baseA\n", "redo paste with terminal LF");
      await page.keyboard.type("x"); await expectText("baseA\nx", "type after redo of terminal LF");
    });
    await run("editor: Backspace across LF and empty placeholder cleanup", async () => {
      await reset("x"); await editor.press("Enter"); await page.keyboard.type("y");
      await editor.press("Backspace"); await expectText("x\n", "delete final letter");
      await editor.press("Backspace"); await expectText("x", "delete terminal LF");
      await select(0, 1); await editor.press("Backspace"); await expectText("", "delete all text");
      check(await editor.evaluate(area => area.matches(":empty")), "Empty editor has no leftover caret BR");
      await page.keyboard.type("z"); await expectText("z", "type after clearing");
    });
    await run("editor: IME composition guards and a single undoable commit", async () => {
      await reset("a");
      const defaults = await editor.evaluate(area => {
        area.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
        const composing = new KeyboardEvent("keydown", { key: "Enter", keyCode: 229, isComposing: true, bubbles: true, cancelable: true });
        const pending = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
        const before = new InputEvent("beforeinput", { inputType: "insertParagraph", isComposing: true, bubbles: true, cancelable: true });
        area.dispatchEvent(composing); area.dispatchEvent(pending); area.dispatchEvent(before);
        area.firstChild.appendData("\u4e2d");
        area.dispatchEvent(new InputEvent("input", { inputType: "insertCompositionText", data: "\u4e2d", isComposing: true, bubbles: true }));
        area.dispatchEvent(new CompositionEvent("compositionend", { data: "\u4e2d", bubbles: true }));
        return [composing.defaultPrevented, pending.defaultPrevented, before.defaultPrevented];
      });
      check(defaults.every(value => !value), "IME Enter/beforeinput are left to the composition session");
      await expectText("a\u4e2d", "composition commits without an accidental LF");
      await editor.press("Control+z"); await expectText("a", "undo composition commit");
      await editor.press("Control+Shift+z"); await expectText("a\u4e2d", "redo composition commit");
      await select(2); await editor.press("Enter"); await page.keyboard.type("x"); await expectText("a\u4e2d\nx", "normal Enter resumes after composition");
    });
    await run("editor: programmatic trailing LF and readonly data contract", async () => {
      await reset("external\n"); await page.keyboard.type("tail"); await expectText("external\ntail", "type after external value setter");
      await reset("readonly\n", 0, 0, true); await expectText("readonly\n", "readonly literal data");
      check(await editor.getAttribute("contenteditable") === "false", "Readonly editor remains noneditable");
      check(await editor.evaluate(area => !area.__editHistory), "Readonly output does not acquire edit history");
    });
  } else {
  for (const [width, height] of [[1366, 768], [1440, 900]]) {
    await run(`laptop ${width}x${height}: initial frames, text clearance and equal columns`, async () => {
      await page.setViewportSize({ width, height }); await go("op/base64");
      // A fresh document proves the initial layout, not a position left by an earlier scroll/drag.
      await page.reload(); await page.locator("#ci_enable_base64").waitFor({ state: "attached" }); await page.locator("#ioOut").waitFor();
      await page.waitForTimeout(350); await capture(`laptop-${width}x${height}-initial`);
      const initial = await page.evaluate(() => {
        const ws = document.getElementById("workspace"), r = ws.getBoundingClientRect();
        const bounds = { left: Math.max(r.left, 0), top: Math.max(r.top, 0), right: Math.min(r.right, innerWidth), bottom: Math.min(r.bottom, innerHeight) };
        const rect = node => { const r = node.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, height: r.height }; };
        const frames = [...document.querySelectorAll(".op-data .io-editor-frame")].map(rect);
        const output = document.querySelector(".io-pane-output"), frame = output.querySelector(".io-editor-frame");
        const coding = output.querySelector(".io-coding-mount"), footer = output.querySelector(".io-report-footer"), report = output.querySelector(".io-report");
        const gaps = (parseFloat(getComputedStyle(output).rowGap) || 0) * 2;
        const reportBudget = frame.getBoundingClientRect().bottom + (coding?.getBoundingClientRect().height || 0) + footer.getBoundingClientRect().height + gaps <= bounds.bottom + 1;
        const config = document.querySelector(".op-config"), data = document.querySelector(".op-data");
        return { bounds, frames, scrollTop: ws.scrollTop, documentScroll: [scrollX, scrollY], reportBudget, report: rect(report),
          configWidth: config.getBoundingClientRect().width, dataWidth: data.getBoundingClientRect().width,
          titleSize: parseFloat(getComputedStyle(config.querySelector(".op-title")).fontSize), descAlign: getComputedStyle(config.querySelector(".op-desc")).textAlign };
      });
      geometry.push({ label: `laptop-${width}x${height}-initial`, ...initial });
      check(initial.scrollTop <= 1 && initial.documentScroll.every(value => value === 0), `Initial laptop load has not scrolled: ${JSON.stringify(initial)}`);
      check(initial.frames.length === 2 && initial.frames.every(r => r.left >= initial.bounds.left - 1 && r.right <= initial.bounds.right + 1
        && r.top >= initial.bounds.top - 1 && r.bottom <= initial.bounds.bottom + 1), `Both complete editor frames fit the visible workspace: ${JSON.stringify(initial)}`);
      check(Math.abs(initial.configWidth - initial.dataWidth) <= 3, "Normal laptop starts at equal config/data widths");
      check(initial.titleSize >= 28 && ["start", "left"].includes(initial.descAlign), "Config title is at least 28px and description is left/start aligned");
      check(initial.report.top >= initial.frames[1].bottom - 1, "Report is below the output frame");
      if (initial.reportBudget) check(initial.report.bottom <= initial.bounds.bottom + 1, "Report remains visible when output views/footer fit the height budget");
      await page.locator("#ioIn").fill("aGVsbG8="); await convert(); await output(/^hello$/);
      const clearance = await page.evaluate(() => [...document.querySelectorAll(".op-data .io-editor-frame")].map(frame => {
        const editor = frame.querySelector(".io-area"), head = frame.querySelector(".io-pane-head"), r = editor.getBoundingClientRect();
        const range = document.createRange(); range.setStart(editor.firstChild, 0); range.setEnd(editor.firstChild, 1);
        return { padding: parseFloat(getComputedStyle(editor).paddingTop), textTop: range.getBoundingClientRect().top,
          headBottom: head.getBoundingClientRect().bottom, toolsRight: head.querySelector(".io-pane-tools").getBoundingClientRect().right, editorRight: r.right };
      }));
      check(clearance.every(r => r.padding >= 44 && r.textTop >= r.headBottom - 1 && r.toolsRight <= r.editorRight + 1), `Toolbar does not overlap actual editor text: ${JSON.stringify(clearance)}`);
      check(await page.locator("#workspace").evaluate(node => node.scrollTop <= 1), "Conversion did not scroll the initial laptop layout");
      await capture(`laptop-${width}x${height}-initial`);
      await contract(`laptop-${width}x${height}`, "split", true);
    });
    await run(`laptop ${width}x${height}: real AES descriptors use 2-3 parameter columns`, async () => {
      await page.setViewportSize({ width, height }); await go("op/aes");
      const grid = await page.locator(".op-config .op-params").evaluate(node => {
        const css = getComputedStyle(node), selects = [...node.querySelectorAll("select")].filter(select => select.getBoundingClientRect().width > 0);
        return { display: css.display, columns: (css.gridTemplateColumns.match(/[\d.]+px/g) || []).length,
          selects: selects.length, usedColumns: new Set(selects.map(select => Math.round(select.closest(".param").getBoundingClientRect().left))).size };
      });
      check(grid.display === "grid" && grid.columns >= 2 && grid.columns <= 3 && grid.selects >= 3 && grid.usedColumns >= 2,
        `Real long-parameter selects occupy multiple grid columns: ${JSON.stringify(grid)}`);
      await noOverflow(`aes-${width}x${height}`);
    });
  }

  await run("editor tools: details keyboard, file picker and toolbar undo/redo", async () => {
    await page.setViewportSize({ width: 1366, height: 768 }); await go("op/base64");
    const details = page.locator(".io-pane-input .io-tools-more"), summary = details.locator(":scope > summary");
    check(await summary.isVisible() && !await details.evaluate(node => node.open), "More tools summary is visible and initially collapsed");
    await page.locator("#ioIn").fill("before-file");
    await summary.focus(); await summary.press("Enter");
    check(await details.evaluate(node => node.open) && await inputTool("放大字号").isVisible(), "Enter opens the lower-priority tools");
    await inputTool("放大字号").focus(); await page.keyboard.press("Escape");
    check(!await details.evaluate(node => node.open) && await summary.evaluate(node => node === document.activeElement), "Escape closes tools and restores summary focus");
    const originalFont = await page.locator("#ioIn").evaluate(node => parseFloat(getComputedStyle(node).fontSize));
    await summary.press("Space"); await inputTool("放大字号").click();
    check(!await details.evaluate(node => node.open) && await read("#ioIn") === "before-file", "Choosing a secondary tool closes the drawer without changing input");
    try { await page.waitForFunction(before => parseFloat(getComputedStyle(document.getElementById("ioIn")).fontSize) > before, originalFont, { timeout: 1500 }); }
    catch { throw new Error(`Font tool did not enlarge ${originalFont}px; actual ${await page.locator("#ioIn").evaluate(node => JSON.stringify({ inline: node.style.fontSize, computed: getComputedStyle(node).fontSize }))}`); }
    check(true, "Font tool performs its real action");
    await summary.click(); await inputTool("缩小字号").click();
    check(await page.locator("#ioIn").evaluate(node => parseFloat(getComputedStyle(node).fontSize)) === originalFont, "Font decrease restores the original size");
    await summary.click(); await page.locator("#ioIn").focus(); await page.waitForTimeout(50);
    check(!await details.evaluate(node => node.open), "Leaving the tools closes the secondary drawer");
    check(await inputTool("选择文件").isVisible() && !await inputTool("选择文件").evaluate(node => !!node.closest("details")), "File picker stays directly available in the editor header");
    const [chooser] = await Promise.all([page.waitForEvent("filechooser"), inputTool("选择文件").click()]);
    await chooser.setFiles({ name: "workbench-editor.txt", mimeType: "text/plain", buffer: Buffer.from("aGVsbG8=", "ascii") });
    await page.waitForFunction(() => document.getElementById("ioIn")?.value === "aGVsbG8="); await output(/^hello$/);
    await inputTool("撤销（Ctrl+Z）").click(); check(await read("#ioIn") === "before-file", "Header undo restores text from before the file load");
    await inputTool("重做（Ctrl+Shift+Z / Ctrl+Y）").click(); check(await read("#ioIn") === "aGVsbG8=", "Header redo restores the exact loaded text");
    await convert(); await output(/^hello$/);
  });

  await run("tablet orientation: iPad portrait/landscape and layout changes preserve both fields", async () => {
    await page.setViewportSize({ width: 1024, height: 1366 }); await go("op/rsaCrt");
    await page.locator("#fld_residues").fill("2, 3, 2"); await page.locator("#fld_moduli").fill("3, 5, 7");
    await convert(); await output(/x = 23/); await contract("ipad-1024x1366-portrait", "stack", true);
    await page.setViewportSize({ width: 1024, height: 768 }); await page.waitForTimeout(350);
    await contract("tablet-1024x768-landscape", "split", true);
    const fieldsIntact = async () => check(await read("#fld_residues") === "2, 3, 2" && await read("#fld_moduli") === "3, 5, 7"
      && /x = 23/.test(await read("#ioOut")), "Orientation/layout changes preserve both fields and their actual result");
    await fieldsIntact();
    const choose = async traditional => {
      await page.locator("#btnFont").click(); await page.locator(".env-panel").waitFor();
      await page.locator(".env-panel .env-layout-seg").getByRole("button", { name: traditional ? /传统|traditional/i : /自适配|adaptive/i }).click();
      await page.keyboard.press("Escape"); await page.locator(".env-panel").waitFor({ state: "detached" });
    };
    let traditional = false;
    try {
      await choose(true); traditional = true; await contract("tablet-traditional", "stack", true); await fieldsIntact();
      await choose(false); traditional = false; await contract("tablet-adaptive", "split", true); await fieldsIntact();
    } finally {
      if (traditional) await choose(false);
      await page.setViewportSize({ width: 1600, height: 1000 });
    }
  });

  await run("base64: split, real conversion, cross-pane chain/report and resize", async () => {
    await go("op/base64");
    await contract("base64-desktop", "split", true);
    check(await page.evaluate(() => Math.abs(document.querySelector(".op-config").getBoundingClientRect().width - document.querySelector(".op-data").getBoundingClientRect().width) <= 3), "Default landscape columns split the available space equally");
    await page.locator("#ioIn").fill("hello");
    await page.locator("#dirSeg button").first().click();
    await convert(); await output(/^aGVsbG8=$/);
    const r = await report();
    check(r.op.id === "base64" && r.input.text === "hello" && r.output.text === "aGVsbG8=", "Report contains actual input/output after split");
    await action("chain").click();
    check(await read("#ioIn") === "aGVsbG8=", "Chain moves actual output into input");
    await page.locator("#dirSeg button").nth(1).click(); await output(/^hello$/);
    await action("swap").click(); await page.waitForTimeout(350);
    check(await read("#ioIn") === "hello" && await read("#ioOut") === "aGVsbG8=", "True swap exchanges panes without automatically decoding");
    const swapped = await report();
    check(swapped.input.text === "hello" && swapped.output.text === "aGVsbG8=", "Report records swapped values without conversion");
    await action("swap").click(); await page.waitForTimeout(350);
    check(await read("#ioIn") === "aGVsbG8=" && await read("#ioOut") === "hello", "Second swap restores both original panes without conversion");
    await capture("desktop");
    const before = await page.locator(".op-config").evaluate(node => node.getBoundingClientRect().width);
    const separator = page.locator(".op-splitter");
    await separator.evaluate(node => {
      window.__workbenchEvents = { pointer: 0, keyboard: 0 };
      node.addEventListener("pointerdown", () => window.__workbenchEvents.pointer++);
      node.addEventListener("keydown", () => window.__workbenchEvents.keyboard++);
    });
    await separator.focus(); await page.keyboard.press("ArrowRight"); await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(200);
    const keyed = await page.locator(".op-config").evaluate(node => node.getBoundingClientRect().width);
    check(keyed > before + 1, "ArrowRight grows parameter column");
    await page.keyboard.press("ArrowLeft"); await page.waitForTimeout(200);
    const shrunk = await page.locator(".op-config").evaluate(node => node.getBoundingClientRect().width);
    check(shrunk < keyed - 1, "ArrowLeft shrinks parameter column");
    await separator.scrollIntoViewIfNeeded(); const box = await separator.boundingBox(); assert(box);
    await page.mouse.move(box.x + box.width / 2, box.y + Math.min(box.height / 2, 100));
    await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + 60, box.y + Math.min(box.height / 2, 100), { steps: 8 }); await page.mouse.up();
    await page.waitForTimeout(200);
    check(await page.locator(".op-config").evaluate(node => node.getBoundingClientRect().width) > shrunk + 10, "Pointer drag resizes parameter column");
    check(await read("#ioIn") === "aGVsbG8=" && await read("#ioOut") === "hello", "Resizing retains both panes' values");
    check(await page.evaluate(() => window.__workbenchEvents.pointer > 0 && window.__workbenchEvents.keyboard >= 2), "Real pointer and keyboard handlers received browser events");
    await contract("base64-resized", "split", true);

    // Landscape remains split even when the operation container is narrower than 900px.
    const originalStyle = await page.locator("#workspace").getAttribute("style");
    try {
      await page.locator("#workspace").evaluate(node => { node.style.flex = "0 0 760px"; node.style.width = "760px"; node.style.maxWidth = "760px"; });
      await page.waitForTimeout(350); await contract("narrow-container-wide-viewport", "split", true);
      check(await read("#ioIn") === "aGVsbG8=", "Narrow landscape split preserves input");
    } finally {
      await page.locator("#workspace").evaluate((node, old) => { if (old === null) node.removeAttribute("style"); else node.setAttribute("style", old); }, originalStyle);
    }
  });

  for (const width of [390, 320]) {
    await run(`base64 mobile ${width}: stack and value retention`, async () => {
      await page.setViewportSize({ width: 1600, height: 1000 }); await go("op/base64");
      await page.locator("#ioIn").fill("aGVsbG8="); await convert(); await output(/^hello$/);
      await page.setViewportSize({ width, height: 844 }); await page.waitForTimeout(350);
      check(await read("#ioIn") === "aGVsbG8=" && await read("#ioOut") === "hello", "Mobile reflow retains input and output");
      await contract(`base64-mobile-${width}`, "stack", true); await capture(`mobile-${width}`);
    });
  }

  await run("layout preference: traditional landscape stack and persistent reload", async () => {
    await page.setViewportSize({ width: 1600, height: 1000 }); await go("op/base64");
    await page.locator("#ioIn").fill("retained-layout-preference");
    const openEnvironment = async () => {
      await page.locator("#btnFont").click(); await page.locator(".env-panel").waitFor();
    };
    const closeEnvironment = async () => { await page.keyboard.press("Escape"); await page.locator(".env-panel").waitFor({ state: "detached" }); };
    const traditional = () => page.locator(".env-panel .dir-seg").getByRole("button", { name: /传统|traditional/i });
    const responsive = () => traditional().locator("..").locator("button").filter({ hasNotText: /传统|traditional/i }).first();
    let needsRestore = false;
    try {
      await openEnvironment(); await traditional().click(); needsRestore = true; await closeEnvironment();
      await contract("traditional-landscape", "stack", true);
      check(await read("#ioIn") === "retained-layout-preference", "Changing layout preference keeps the actual editor data");
      await page.reload(); await page.locator("#ci_enable_base64").waitFor({ state: "attached" });
      await contract("traditional-after-reload", "stack", true);
      await openEnvironment();
      check(await traditional().getAttribute("aria-pressed") === "true", "Environment shows the persisted traditional selection");
      await responsive().click(); needsRestore = false; await closeEnvironment();
      await page.reload(); await page.locator("#ci_enable_base64").waitFor({ state: "attached" }); await contract("responsive-after-reload", "split", true);
      await page.setViewportSize({ width: 1400, height: 1600 }); await page.waitForTimeout(300);
      await contract("responsive-large-portrait", "stack", true);
    } finally {
      await page.setViewportSize({ width: 1600, height: 1000 });
      if (needsRestore && !await page.locator(".env-panel").count()) await openEnvironment();
      if (await page.locator(".env-panel").count()) {
        if (await traditional().count()) await responsive().click();
        await closeEnvironment();
      }
    }
  });

  await run("family: production RSA drawer delegates selection and survives routing", async () => {
    await page.setViewportSize({ width: 1600, height: 1000 }); await go("op/rsaModinv");
    const root = page.locator("#workspace .fam-seg.family-overflow"), launcher = root.locator(".family-more");
    await launcher.waitFor();
    const current = await root.locator('button.on:not([data-family-more])').textContent();
    check(await root.evaluate(node => node.scrollWidth <= node.clientWidth + 1), "Production RSA family has no horizontal scrolling");
    await launcher.click();
    const popup = page.locator("body > .family-overflow-menu"); await popup.waitFor();
    const chosen = popup.locator('[role="menuitemradio"][aria-checked="false"]:not(:disabled)').first();
    const next = await chosen.locator(".family-choice-label").textContent();
    check(next !== current, "Drawer test chooses a different actual RSA operation");
    await chosen.click();
    await page.waitForFunction(label => document.querySelector('#workspace .fam-seg button.on:not([data-family-more])')?.textContent === label, next);
    check(await popup.count() === 0, "Routing disposes the old body portal");
    try { await page.waitForFunction(() => document.querySelector("#workspace .fam-seg")?.contains(document.activeElement), null, { timeout: 2000 }); }
    catch { throw new Error(`New family selection did not retain focus; active ${await page.evaluate(() => JSON.stringify({ tag: document.activeElement?.tagName, id: document.activeElement?.id, class: document.activeElement?.className }))}`); }
    check(true, "New operation restores focus to the selected family representation");
  });

  await run("splitter: Home/End, Shift steps, Enter and double-click reset", async () => {
    await page.setViewportSize({ width: 1600, height: 1000 }); await go("op/base64");
    const splitter = page.locator(".op-splitter");
    const width = () => page.locator(".op-config").evaluate(node => node.getBoundingClientRect().width);
    const equal = () => page.evaluate(() => Math.abs(document.querySelector(".op-config").getBoundingClientRect().width - document.querySelector(".op-data").getBoundingClientRect().width) <= 3);
    await splitter.focus(); await splitter.press("Enter");
    check(await equal(), "Enter resets the columns to equal widths");
    await splitter.press("End");
    check(Math.abs(await width() - Number(await splitter.getAttribute("aria-valuemax"))) <= 1, "End reaches the published maximum");
    check(await page.locator(".op-data").evaluate(node => node.getBoundingClientRect().width > 0 && node.scrollWidth <= node.clientWidth + 2), "Maximum config keeps a bounded, usable data column");
    await splitter.press("Home");
    check(Math.abs(await width() - Number(await splitter.getAttribute("aria-valuemin"))) <= 1, "Home reaches the published minimum");
    const minimum = await width(); await splitter.press("Shift+ArrowRight");
    check(Math.abs(await width() - minimum - 48) <= 1, "Shift+ArrowRight uses the documented larger step");
    await splitter.press("ArrowRight"); await splitter.dblclick();
    check(await equal(), "Double-click resets the columns to equal widths");
    check(Math.abs(Number(await splitter.getAttribute("aria-valuenow")) - await width()) <= 1, "Separator aria-valuenow follows actual geometry");
    await contract("splitter-reset", "split");
  });

  await run("splitter: RTL keyboard and pointer direction", async () => {
    await page.setViewportSize({ width: 1600, height: 1000 });
    await go("op/base64");
    const previousDir = await page.locator("html").getAttribute("dir");
    try {
      await page.locator("html").evaluate(node => node.dir = "rtl"); await page.waitForTimeout(300);
      const splitter = page.locator(".op-splitter");
      const width = () => page.locator(".op-config").evaluate(node => node.getBoundingClientRect().width);
      await splitter.focus(); await splitter.press("Enter"); const before = await width();
      await splitter.press("ArrowLeft"); check(await width() > before + 1, "RTL ArrowLeft grows the right-side parameter column");
      await splitter.press("ArrowRight"); check(Math.abs(await width() - before) <= 1, "RTL ArrowRight restores its width");
      await splitter.scrollIntoViewIfNeeded(); const box = await splitter.boundingBox(); assert(box);
      const x = box.x + box.width / 2, y = box.y + Math.min(100, box.height / 2);
      await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x - 60, y, { steps: 8 }); await page.mouse.up();
      check(await width() > before + 30, "RTL leftward pointer drag grows the column");
      check(!await page.locator(".op-workbench").evaluate(node => node.classList.contains("is-resizing")), "Pointer release ends resizing");
      await contract("base64-rtl", "split");
      await splitter.press("Enter");
    } finally {
      await page.locator("html").evaluate((node, dir) => { if (dir === null) node.removeAttribute("dir"); else node.setAttribute("dir", dir); }, previousDir);
    }
  });

  await run("splitter: real touch tap/capture; Chromium native touch drag", async () => {
    const touch = await browser.newContext({ hasTouch: true, viewport: { width: 1600, height: 1000 }, locale: "zh-CN", serviceWorkers: "block" });
    try {
      await touch.addInitScript(() => localStorage.setItem("ebctf_locale", "zh"));
      const tab = await touch.newPage(); tab.on("pageerror", error => errors.push({ url: tab.url(), message: error.message }));
      await tab.goto(new URL("#/op/base64", base).href);
      const splitter = tab.locator('.op-workbench[data-layout="split"] .op-splitter'); await splitter.waitFor();
      await splitter.scrollIntoViewIfNeeded();
      await splitter.evaluate(node => {
        window.__workbenchTouch = [];
        node.addEventListener("pointerdown", event => window.__workbenchTouch.push({ type: event.pointerType, trusted: event.isTrusted }));
      });
      const box = await splitter.boundingBox(); assert(box);
      check(box.width >= 44, "Coarse-pointer splitter has a 44px hit target");
      const x = box.x + box.width / 2, y = box.y + Math.min(100, box.height / 2);
      await tab.touchscreen.tap(x, y);
      check(await tab.evaluate(() => window.__workbenchTouch.some(event => event.type === "touch" && event.trusted)), "Real trusted touch pointer event reaches the splitter");
      check(!await tab.locator(".op-workbench").evaluate(node => node.classList.contains("is-resizing")), "Touch release clears capture/resizing state");
      if (engine === "chromium") {
        const session = await touch.newCDPSession(tab);
        const before = await tab.locator(".op-config").evaluate(node => node.getBoundingClientRect().width);
        try {
          await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y, id: 1 }] });
          for (let i = 1; i <= 8; i++) await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x + i * 8, y, id: 1 }] });
          await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
          check(await tab.locator(".op-config").evaluate(node => node.getBoundingClientRect().width) > before + 30, "Trusted native touch drag resizes the parameter column");
          check(!await tab.locator(".op-workbench").evaluate(node => node.classList.contains("is-resizing")), "Touch drag release clears resizing state");
        } finally { await session.detach(); }
      }
    } finally { await touch.close(); }
  });

  await run("freqDist: actual aab, Enter and Ctrl+Enter", async () => {
    await page.setViewportSize({ width: 1600, height: 1000 }); await go("op/freqDist");
    await contract("freqDist", "split");
    check(await page.locator("#ioIn").isVisible() && await page.locator(".io-none-hint").count() === 0, "Frequency input is visible");
    await page.locator("#ioIn").fill("aab"); await page.locator("#ioIn").press("Control+Enter");
    await output(/a\t2\t66\.67%/); check(/b\t1\t33\.33%/.test(await read("#ioOut")), "Both frequency rows consume input");
    await page.locator("#ioIn").fill("line"); await page.locator("#ioIn").press("End"); await page.locator("#ioIn").press("Enter");
    check(await read("#ioIn") === "line\n", "Plain Enter keeps a literal newline");
  });

  for (const id of [...trafficIds, "usbKeyboard", "usbMouse", "entropy"]) {
    await run(`${id}: route-only input inventory`, async () => {
      await go(`op/${id}`);
      check(await page.locator(".op-data #ioIn").isVisible(), `${id}: visible data-pane input/file target`);
      check(await page.locator(".io-none-hint").count() === 0, `${id}: no false no-input hint`);
    });
  }

  await run("trafficReadable: hex/base64, file picker, drop, edit invalidation and clear", async () => {
    await page.setViewportSize({ width: 1600, height: 1000 });
    await go("op/trafficReadable"); await contract("trafficReadable", "split");
    for (const encoding of ["hex", "base64"]) {
      // text view intentionally UTF-8 encodes acceptsBytes input; select the real byte representation.
      await page.locator(`.io-pane:first-child .io-coding-view[data-view="${encoding}"]`).click();
      await page.locator("#ioIn").fill(fixture.toString(encoding)); await convert(); await output(/flag\{workbench_fixture\}/, `trafficReadable ${encoding}`);
    }
    await page.locator('.io-pane:first-child .io-coding-view[data-view="text"]').click();
    const [chosen] = await Promise.all([page.waitForEvent("filechooser"), inputTool("选择文件").click()]);
    await chosen.setFiles({ name: "workbench-http.pcap", mimeType: "application/vnd.tcpdump.pcap", buffer: fixture });
    await page.waitForFunction(() => document.getElementById("ioIn")?.value.includes("workbench-http.pcap"));
    await output(/flag\{workbench_fixture\}/);
    check((await read("#ioIn")).includes("workbench-http.pcap"), "File picker keeps a visible filename placeholder");
    // output already contained the flag before choosing; explicitly rerun to verify the byte path.
    await convert(); await output(/flag\{workbench_fixture\}/);
    await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(350);
    check((await read("#ioIn")).includes("workbench-http.pcap"), "Mobile retains the file input");
    await inputTool("清空").click();
    check(await read("#ioIn") === "" && await read("#ioOut") === "", "Clear empties both panes");
    await convert(); const empty = await output(/空输入/); check(!empty.includes(flag), "Clear cannot resurrect cached PCAP bytes");
    await page.locator("#ioIn").evaluate((node, bytes) => {
      const transfer = new DataTransfer(); transfer.items.add(new File([new Uint8Array(bytes)], "workbench-drop.pcap", { type: "application/vnd.tcpdump.pcap" }));
      node.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: transfer }));
      node.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }));
    }, [...fixture]);
    await output(/flag\{workbench_fixture\}/);
    check((await read("#ioIn")).includes("workbench-drop.pcap"), "Browser drop event loads the PCAP");
    await page.locator("#ioIn").fill("00"); await convert();
    await page.waitForFunction(flag => !document.getElementById("ioOut").value.includes(flag), flag);
    check(!(await read("#ioOut")).includes(flag), "Manual input event invalidates old file bytes");
    await contract("traffic-file-mobile", "stack");
  });

  await run("long parameters: colossus display and input retention", async () => {
    await page.setViewportSize({ width: 1600, height: 900 }); await go("op/colossus");
    await contract("colossus-desktop", "split");
    check(await page.locator(".op-config .op-params .param").count() >= 15, "Real long-parameter operation is in config column");
    check(await page.locator(".op-config .op-params").evaluate(node => getComputedStyle(node).display === "grid"
      && (getComputedStyle(node).gridTemplateColumns.match(/[\d.]+px/g) || []).length >= 2), "Wide config arranges parameters in two or more grid columns");
    await page.locator("#ioIn").fill("retained-long-parameter-input");
    await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(350);
    await contract("colossus-mobile", "stack");
    check(await read("#ioIn") === "retained-long-parameter-input", "Long-parameter mobile reflow preserves input");
  });

  await run("low-height long-parameter layout: controls and data remain reachable", async () => {
    await page.setViewportSize({ width: 1600, height: 480 }); await go("op/colossus");
    await page.locator("#ioIn").fill("low-height-retained");
    await contract("colossus-low-height", "split");
    await page.locator(".op-config .ci-edit-btn").focus();
    check(await page.locator(".op-config").evaluate(node => node.scrollTop > 0), "Long settings can scroll to their final controls");
    await page.locator("#ioIn").scrollIntoViewIfNeeded();
    const accessible = await page.locator("#ioIn").evaluate(node => {
      const r = node.getBoundingClientRect(), ws = document.getElementById("workspace").getBoundingClientRect();
      return r.bottom > Math.max(ws.top, 0) && r.top < Math.min(ws.bottom, innerHeight);
    });
    check(accessible && await read("#ioIn") === "low-height-retained", "Input stays reachable and intact at 480px height");
    await noOverflow("colossus-low-height-scrolled");
  });

  await run("qrGen: real image output remains in data pane", async () => {
    await page.setViewportSize({ width: 1600, height: 1000 }); await go("op/qrGen");
    await page.locator("#ioIn").fill("Workbench"); await convert();
    await page.waitForFunction(() => document.querySelector("#ioOutMedia img")?.naturalWidth > 0);
    check(await page.locator(".op-data #ioOutMedia img").count() > 0, "Generated QR image belongs to output pane");
    await contract("qrGen-desktop", "split");
    await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(350);
    await contract("qrGen-mobile", "stack"); check(await read("#ioIn") === "Workbench", "Image reflow retains source input");
  });

  await run("multi-field rsaCrt: both fields, mobile, conversion and report", async () => {
    await page.setViewportSize({ width: 1600, height: 1000 }); await go("op/rsaCrt");
    await contract("rsaCrt-desktop", "split");
    check(await page.locator("#ioIn").count() === 0 && await page.locator(".op-data .io-field-area").count() === 2, "Two real fields replace the single main input");
    check(await action("chain").isDisabled() && await action("swap").isDisabled(), "Multi-field chain and swap are disabled pending product policy");
    await page.locator("#fld_residues").fill("2, 3, 2"); await page.locator("#fld_moduli").fill("3, 5, 7");
    await page.locator("#fld_moduli").press("Control+Enter"); await output(/x = 23/);
    await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(350);
    await contract("rsaCrt-mobile", "stack");
    check(await read("#fld_residues") === "2, 3, 2" && await read("#fld_moduli") === "3, 5, 7", "Both fields survive mobile reflow");
    const r = await report(); check(r.input.text === "2, 3, 2\n3, 5, 7" && /x = 23/.test(r.output.text), "Report includes both fields in declared order");
  });

  await run("multi-line babaiCvp: display/input retention only", async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await go("op/babaiCvp");
    // Playwright fill(multiline) inserts block DIVs in Chromium/WebKit, unlike ioArea's real Enter/paste path.
    // Exercise the application's plain-text paste handler; Firefox ignores ClipboardEvent constructor data.
    const basis = page.locator("#fld_basis");
    await basis.fill(""); await basis.focus();
    await basis.evaluate(node => {
      const range = document.createRange(); range.selectNodeContents(node); range.collapse(false);
      const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
      const clipboardData = new DataTransfer(); clipboardData.setData("text/plain", "14 23 5\n7 12 3\n3 8 2");
      const event = new Event("paste", { bubbles: true, cancelable: true });
      Object.defineProperty(event, "clipboardData", { value: clipboardData }); node.dispatchEvent(event);
    });
    await page.locator("#fld_target").fill("10 19 4");
    check(await read("#fld_basis") === "14 23 5\n7 12 3\n3 8 2", "Application plain-text paste preserves all source newlines before resizing");
    await contract("babaiCvp-mobile", "stack");
    await page.setViewportSize({ width: 1600, height: 1000 }); await page.waitForTimeout(350);
    check(await read("#fld_basis") === "14 23 5\n7 12 3\n3 8 2" && await read("#fld_target") === "10 19 4", "Multiline field data survives both layouts");
  });

  await run("multi-line editor: real typing after Enter stays on the next line", async () => {
    await page.setViewportSize({ width: 390, height: 844 }); await go("op/babaiCvp");
    const basis = page.locator("#fld_basis");
    await basis.fill("first"); await basis.press("End"); await basis.press("Enter");
    check(await read("#fld_basis") === "first\n", "Enter inserts a literal newline");
    await page.keyboard.type("second");
    check(await read("#fld_basis") === "first\nsecond", `Typing after Enter retains line order: ${JSON.stringify(await read("#fld_basis"))}`);
  });

  await run("no-input rsaEgcd: semantic hint and parameter-only execution", async () => {
    await page.setViewportSize({ width: 1600, height: 1000 });
    await go("op/rsaEgcd"); await contract("rsaEgcd", "split");
    check(await page.locator("#ioIn").count() === 0 && await page.locator(".op-config .op-no-input-note").isVisible(), "No fake main input for a parameter-only operation");
    check(await action("chain").isDisabled() && await action("swap").isDisabled(), "No-input chain and swap are disabled");
    await (await parameter("a")).fill("30"); await (await parameter("b")).fill("18");
    await convert(); await output(/gcd\(a, b\) = 6/);
  });

  await run("no-input rsaModinv: parameter-only execution in both directions", async () => {
    await page.setViewportSize({ width: 1600, height: 1000 }); await go("op/rsaModinv");
    await contract("rsaModinv", "split");
    check(!await page.locator("#ci_enable_rsaModinv").isChecked(), "rsaModinv custom implementation is disabled");
    const metadata = await page.evaluate(async url => {
      const { getOp, inferIoMode } = await import(url), op = getOp("rsaModinv");
      return { io: op.io, inferred: inferIoMode(op), encode: typeof op.encode, decode: typeof op.decode };
    }, new URL("src/core/registry.js", base).href);
    check(metadata.io === "none" && metadata.inferred === "none" && metadata.encode === "function" && metadata.decode === "function",
      "rsaModinv has explicit no-input metadata and two registered directions");
    await (await parameter("a")).fill("3"); await (await parameter("m")).fill("11");
    for (const [index, direction] of ["encode", "decode"].entries()) {
      await page.locator("#dirSeg button").nth(index).click(); await convert(); await output(/^4$/, `rsaModinv ${direction}`);
      check(await page.locator("#ioIn").count() === 0 && await page.locator(".op-config .op-no-input-note").isVisible(), `${direction}: parameter-only execution has no main input`);
      check(await read("#p_a") === "3" && await read("#p_m") === "11", `${direction}: both parameters are preserved`);
    }
  });

  await run("no-input custom override: toggling restores a usable main input", async () => {
    await page.setViewportSize({ width: 1600, height: 1000 });
    const moduleUrl = new URL("src/core/customImplStore.js", base).href;
    await go("op/rsaEgcd");
    await page.evaluate(async url => {
      const { saveCustomImpl } = await import(url);
      saveCustomImpl("rsaEgcd", { enabled: false, code: 'return "custom:" + input;' });
    }, moduleUrl);
    try {
      await page.reload(); await page.locator("#ci_enable_rsaEgcd").waitFor({ state: "attached" });
      check(await page.locator("#ioIn").count() === 0, "Disabled custom code preserves no-input semantics");
      await page.locator('label.switch[for="ci_enable_rsaEgcd"]').click();
      await page.locator("#ioIn").waitFor();
      check(await page.locator(".io-none-hint").count() === 0, "Custom override replaces the no-input hint immediately");
      await page.locator("#ioIn").fill("retained"); await convert(); await output(/^custom:retained$/);
      check(await action("chain").isEnabled() && await action("swap").isEnabled(), "Custom input enables data actions");
      await page.locator('label.switch[for="ci_enable_rsaEgcd"]').click();
      check(await page.locator("#ioIn").count() === 0 && await page.locator(".io-none-hint").isVisible(), "Disabling custom restores semantic no-input mode");
      await page.locator('label.switch[for="ci_enable_rsaEgcd"]').click();
      check(await read("#ioIn") === "retained", "Re-enabling custom preserves the prior editor input");
    } finally {
      await page.evaluate(async url => { const { clearCustomImpl } = await import(url); clearCustomImpl("rsaEgcd"); }, moduleUrl);
    }
  });

  for (const [id, selector] of [["cryptoTryAll", ".crypto-form"], ["stegSolve", ".sspage"],
    ...specialOps.slice(2).map(id => [id, "#ioOut"])]) {
    await run(`${id}: independent display-only layout`, async () => {
      await page.setViewportSize({ width: 1600, height: 1000 }); await go(`op/${id}`, selector);
      check(await page.locator(id === 'stegSolve' ? '.sspage-workbench' : '.op-workbench').count() === (id === 'stegSolve' ? 1 : 0), `${id}: approved special renderer boundary`);
      await noOverflow(`${id}-desktop`);
      await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(350); await noOverflow(`${id}-mobile`);
    });
  }

  const selectors = [".home-input", ".allops-card", ".recipe-bar", ".exhaust-view", ".uv-tabs", ".ci-card", ".qc-view", ".about-page", ".plugin-page"];
  for (const [i, route] of nonOpPages.entries()) {
    await run(`${route}: non-op display-only layout isolation`, async () => {
      await page.setViewportSize({ width: 1600, height: 1000 }); await go(route, selectors[i]);
      if (route === 'recipe') check(await page.locator('.special-workbench').count() === 1, 'recipe: approved special workbench');
      else if (route === 'codeimg') check(await page.locator('.ci-view > .ci-body').count() === 1 && await page.locator('.special-workbench').count() === 0,
        'codeimg: restored original recognition-and-category layout');
      else check(await page.locator(".op-workbench,.op-splitter").count() === 0, `${route}: no ordinary-op wrapper leaks`);
      await noOverflow(`${route}-desktop`);
      await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(350); await noOverflow(`${route}-mobile`);
    });
  }
  }
  await run("browser events and source freeze", async () => {
    check(errors.length === 0, `Uncaught page errors: ${JSON.stringify(errors)}`);
    check(JSON.stringify(fingerprint()) === JSON.stringify(baseline), "Main/registry/workbench sources stayed unchanged during run");
  });
  const failures = cases.filter(item => item.verdict === "FAIL");
  const detailed = { verdict: failures.length ? "FAIL" : "PASS", browser: engine, channel: channel || null, checks, cases,
    pageErrors: errors, consoleErrors, failedRequests, geometry, editorEvidence, screenshots: [...screenshots], baseline, uncovered };
  const summary = { verdict: detailed.verdict, browser: engine, channel: detailed.channel, checks, passedCases: cases.length - failures.length,
    totalCases: cases.length, failures: failures.map(item => ({ name: item.name, error: item.error.split("\n")[0], url: item.url })),
    pageErrors: errors, consoleErrorCount: consoleErrors.length, failedRequestCount: failedRequests.length, screenshots: [...screenshots], baseline };
  console.log(JSON.stringify(process.argv.includes("--json") ? detailed : summary));
  if (failures.length) process.exitCode = 1;
} finally { await browser.close(); }
