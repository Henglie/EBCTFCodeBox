// Local license checks. Never opens encrypted production keys; ephemeral test keys stay in memory.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createHash, generateKeyPairSync, sign, verify, webcrypto } from "node:crypto";
import { deflateSync } from "node:zlib";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve, join } from "node:path";
import { loadLicense, OPENSOURCE_LICENSE, PUBLIC_KEY_B64, verifyLicense, licensePublicKeyFingerprint } from "../src/core/license.js";
import { resolveLicenseBranding, prepareLicenseBranding, licenseIconSource, inspectRaster, validateRasterDataUrl, validateRasterContent, LICENSE_LIMITS } from "../src/core/licenseBranding.js";
import { signConfig, main as signMain } from "../授权/sign.mjs";
const api = globalThis.EBCryptoLicense, issuer = globalThis.EBCryptoIssuer;
const root = fileURLToPath(new URL("../", import.meta.url));
const hash = data => createHash("sha256").update(data).digest("hex");
let count = 0;
const check = (value, message) => { assert.ok(value, message); count++; };
const reject = async (fn, pattern, label) => { await assert.rejects(fn, pattern, label); count++; };
const throws = (fn, pattern, label) => { assert.throws(fn, pattern, label); count++; };
const testKeys = () => generateKeyPairSync("ec", { namedCurve: "prime256v1", publicKeyEncoding: { type: "spki", format: "pem" }, privateKeyEncoding: { type: "pkcs8", format: "pem" } });
const keys = testKeys(), wrong = testKeys();
const rawSign = (raw, key = keys.privateKey) => Buffer.from(raw).toString("base64url") + "." + sign("sha256", Buffer.from(raw), { key, dsaEncoding: "ieee-p1363" }).toString("base64url");
function png(width = 2, height = 2, corruptStream = false) {
  const chunk = (type, bytes) => {
    const typeBytes = Buffer.from(type), data = Buffer.concat([typeBytes, bytes]);
    let crc = 0xffffffff;
    for (const byte of data) { crc ^= byte; for (let i = 0; i < 8; i++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1; }
    const size = Buffer.alloc(4), sum = Buffer.alloc(4); size.writeUInt32BE(bytes.length); sum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([size, data, sum]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr),
    chunk("IDAT", corruptStream ? Buffer.from([1, 2, 3]) : deflateSync(Buffer.alloc((2 * 4 + 1) * 2, 0))), chunk("IEND", Buffer.alloc(0))]);
}
const image = png(), dataUrl = `data:image/png;base64,${image.toString("base64")}`;
const testConfig = { v: 1, source: "test-only", licensedTo: "TEST FIXTURE", issuedAt: "2026-01-02T03:04:05.000Z",
  note: "temporary key only", appName: "TEST BRAND", appIcon: dataUrl,
  ext: { title: "TEST", img: dataUrl, imgCap: "TEST IMAGE", rows: [{ icon: "public", label: "TEST", value: "VALUE", href: "https://example.invalid/" }] } };
const newBin = await signConfig(testConfig, keys.privateKey);
await reject(() => signMain(["--to", "TEST"]), /OUT_REQUIRED/, "CLI requires explicit output before key read");
await reject(() => signMain(["--to", "TEST", "--out", "unused.bin", "--key", "private_key.enc"]), /PEM_REQUIRED/, "CLI rejects enc without reading it");
await reject(() => signMain(["--unknown", "value"]), /ARGUMENTS/, "CLI argument validation");
const result = await verifyLicense(newBin, { publicKey: keys.publicKey });
check(result.payload.appName === testConfig.appName && result.payload.appIcon === dataUrl, "new signed branding");
check(verify("sha256", result.payloadBytes, { key: keys.publicKey, dsaEncoding: "ieee-p1363" }, result.signature), "independent Node verify of issuer output");
const cryptoKey = await webcrypto.subtle.importKey("pkcs8", Buffer.from(keys.privateKey.replace(/-----[^-]+-----|\s/g, ""), "base64"), { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
const browserStyle = await issuer.signPayload(testConfig, cryptoKey);
check(verify("sha256", Buffer.from(browserStyle.bin.split(".")[0], "base64url"), { key: keys.publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(browserStyle.bin.split(".")[1], "base64url")), "Web Crypto issuer -> independent Node verify");
const spaced = '{  "note": "\\u4e2d",\n "licensedTo":"TEST", "source":"test", "v":1 }';
check((await verifyLicense(rawSign(spaced), { publicKey: keys.publicKey })).payloadBytes.length === Buffer.byteLength(spaced), "raw bytes preserve whitespace/escape/order");
const payloadText = Buffer.from(newBin.split(".")[0], "base64url").toString("utf8");
const tampered = Buffer.from(payloadText.replace("TEST BRAND", "EVIL BRAND")).toString("base64url") + "." + newBin.split(".")[1];
await reject(() => verifyLicense(tampered, { publicKey: keys.publicKey }), /SIGNATURE_INVALID/, "tampered name");
const iconTamper = JSON.parse(payloadText); iconTamper.appIcon = dataUrl.slice(0, -4) + "AAAA";
await reject(() => verifyLicense(Buffer.from(JSON.stringify(iconTamper)).toString("base64url") + "." + newBin.split(".")[1], { publicKey: keys.publicKey }), /SIGNATURE_INVALID/, "tampered icon");
const sigTamper = Buffer.from(newBin.split(".")[1], "base64url"); sigTamper[0] ^= 1;
await reject(() => verifyLicense(newBin.split(".")[0] + "." + sigTamper.toString("base64url"), { publicKey: keys.publicKey }), /SIGNATURE_INVALID/, "wrong signature bytes");
await reject(() => verifyLicense(newBin, { publicKey: wrong.publicKey }), /SIGNATURE_INVALID/, "wrong key");
await reject(() => verifyLicense(newBin), /SIGNATURE_INVALID/, "test key not production key");
await reject(() => verifyLicense(rawSign("null"), { publicKey: keys.publicKey }), /PAYLOAD_TYPE/, "signed null");
await reject(() => verifyLicense(rawSign("[]"), { publicKey: keys.publicKey }), /PAYLOAD_TYPE/, "signed array");
for (const bin of ["", "abc", newBin + ".x", "!.AA", newBin.split(".")[0] + ".AA"]) await reject(() => verifyLicense(bin), /FORMAT|BASE64|BUDGET/, "malformed envelope");
await reject(() => verifyLicense("A".repeat(LICENSE_LIMITS.binBytes + 1)), /BIN_BUDGET/, "envelope budget");
const fakeFetch = bin => async () => ({ ok: true, text: async () => bin });
const loaded = await loadLicense({ fetchImpl: fakeFetch(newBin), publicKey: keys.publicKey });
check(loaded.verified && loaded.appName === testConfig.appName && loaded.ext.img === dataUrl, "loadLicense new fields and legacy ext");
for (const fetchImpl of [async () => ({ ok: false }), async () => { throw new Error("offline"); }, fakeFetch(tampered)])
  check(await loadLicense({ fetchImpl, publicKey: keys.publicKey }) === OPENSOURCE_LICENSE, "missing/invalid/offline fallback");
check(await loadLicense({ fetchImpl: async () => ({ ok: true, headers: { get: () => String(LICENSE_LIMITS.binBytes + 1) }, text: () => { throw new Error("must not read"); } }) }) === OPENSOURCE_LICENSE, "declared length budget");
check((await loadLicense({ fetchImpl: async () => new Response(newBin), publicKey: keys.publicKey })).verified, "streamed real Response");
let cancelled = false;
const oversized = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(LICENSE_LIMITS.binBytes + 1)); }, cancel() { cancelled = true; } });
check(await loadLicense({ fetchImpl: async () => new Response(oversized) }) === OPENSOURCE_LICENSE && cancelled, "stream budget cancels response without content-length");
const brand = resolveLicenseBranding(loaded);
check(brand.appIcon.width === 2 && brand.ext.img === dataUrl, "safe branding projection");
check(licenseIconSource(loaded) === dataUrl && licenseIconSource(OPENSOURCE_LICENSE) === "public/logo.webp", "source and fallback");
check(resolveLicenseBranding({ ...loaded, verified: false }).appName === null, "unsigned data ignored");
check(resolveLicenseBranding({ ...loaded, appIcon: "data:image/svg+xml;base64,PHN2Zy8+" }).appIcon === null, "SVG fallback");
check(resolveLicenseBranding({ ...loaded, appIcon: dataUrl, ext: { img: "https://example.invalid/image.png", rows: [{ href: "javascript:alert(1)", value: "test" }] } }).ext.rows[0].href === null, "dangerous link rejected");
check(resolveLicenseBranding({ ...loaded, appIcon: null }).appIcon === null, "missing icon");
check(inspectRaster(image).mime === "image/png", "PNG sniff and structure");
check(validateRasterDataUrl(dataUrl).width === 2, "PNG data URL");
check(api.decode64(api.encode64(new Uint8Array(1024 * 1024))).length === 1024 * 1024, "large Base64 conversion avoids argument-stack overflow");
check((await validateRasterContent(dataUrl)).width === 2, "PNG zlib and scanline validation");
const badStream = `data:image/png;base64,${png(2, 2, true).toString("base64")}`;
await reject(() => validateRasterContent(badStream), /IMAGE_DECODE/, "PNG damaged compressed stream");
await reject(() => validateRasterContent(`data:image/png;base64,${png(3, 2).toString("base64")}`), /IMAGE_DECODE/, "PNG wrong inflated scanline size");
await reject(() => signConfig({ ...testConfig, appIcon: badStream }, keys.privateKey), /IMAGE_DECODE/, "CLI refuses damaged compressed image");
check((await prepareLicenseBranding({ ...loaded, appIcon: badStream })).appIcon === null, "application async image corruption fallback");
const damaged = Buffer.from(image); damaged[damaged.length - 1] ^= 1;
throws(() => inspectRaster(damaged), /IMAGE_CORRUPT/, "PNG CRC corruption");
throws(() => inspectRaster(image.subarray(0, image.length - 3)), /IMAGE_CORRUPT/, "truncated PNG");
throws(() => inspectRaster(Buffer.from("<svg/>")), /IMAGE_TYPE/, "SVG bytes");
throws(() => inspectRaster(Buffer.from("GIF89a")), /IMAGE_TYPE/, "GIF rejected");
throws(() => inspectRaster(image, "icon", "image/jpeg"), /IMAGE_MIME/, "MIME mismatch");
throws(() => inspectRaster(png(1025, 2)), /IMAGE_DIMENSIONS/, "icon dimensions");
throws(() => inspectRaster(png(2049, 2), "feed"), /IMAGE_DIMENSIONS/, "feed dimensions");
throws(() => inspectRaster(png(0, 2)), /IMAGE_DIMENSIONS/, "zero dimension");
throws(() => inspectRaster(new Uint8Array(LICENSE_LIMITS.icon.bytes + 1)), /IMAGE_BYTES/, "icon byte budget");
throws(() => inspectRaster(new Uint8Array(LICENSE_LIMITS.feed.bytes + 1), "feed"), /IMAGE_BYTES/, "feed byte budget");
throws(() => validateRasterDataUrl(dataUrl.replace("image/png", "image/jpeg")), /IMAGE_MIME/, "data URL MIME mismatch");
throws(() => validateRasterDataUrl("data:text/html;base64,PHN2Zy8+"), /IMAGE_TYPE/, "HTML rejected");
for (const patch of [{ licensedTo: 12 }, { appName: {} }, { appIcon: [] }, { ext: [] }, { issuedAt: "bad-date" }, { v: 2 }, { ext: { rows: "bad" } }, { ext: { rows: [{ href: "javascript:alert(1)" }] } }, { appName: "x".repeat(121) }])
  throws(() => issuer.preparePayload({ ...testConfig, ...patch }), /TYPE|LENGTH|VERSION|IMAGE|ROWS|HREF/, "issuer schema rejection");
check(issuer.preparePayload({ ...testConfig, legacyUnknown: { value: 1 } }).legacyUnknown.value === 1, "unknown legacy fields preserved");

// Production samples: only read, verify and hash. Never print payloads or channel names.
const sampleDir = join(root, "授权", "成品授权");
const samples = readdirSync(sampleDir).filter(name => name.startsWith("license.bin")).sort().map(name => readFileSync(join(sampleDir, name)));
const sampleResults = [];
for (const [index, bytes] of samples.entries()) {
  const before = hash(bytes), raw = bytes.toString("utf8"), old = await verifyLicense(raw);
  check(verify("sha256", old.payloadBytes, { key: readFileSync(join(root, "public/license-verifier/public-key.pem"), "utf8"), dsaEncoding: "ieee-p1363" }, old.signature), "legacy independent Node verify");
  const legacyLoaded = await loadLicense({ fetchImpl: fakeFetch(raw) });
  check(legacyLoaded.verified, "legacy loadLicense");
  assert.deepEqual(legacyLoaded.ext, old.payload.ext || null, "legacy ext unchanged"); count++;
  check(legacyLoaded.appName === (typeof old.payload.appName === "string" && old.payload.appName.trim() ? old.payload.appName.trim() : null), "legacy name unchanged");
  check((await prepareLicenseBranding(legacyLoaded)).warnings.length === 0, "legacy display metadata valid");
  sampleResults.push({ index: index + 1, bytes: bytes.length, sha256: before, verified: true });
}
check(PUBLIC_KEY_B64 === readFileSync(join(root, "授权/public_key.b64"), "utf8").trim(), "original SPKI unchanged");
const fingerprint = await licensePublicKeyFingerprint();
check(hash(api.publicKeyBytes()) === fingerprint, "independent SPKI fingerprint");
check(readFileSync(join(root, "public/license-verifier/fingerprint.txt"), "utf8").includes(fingerprint), "fingerprint artifact");

const browserResults = [];
if (process.argv.includes("--browser")) {
  const require = createRequire(import.meta.url);
  const pw = require(process.env.PLAYWRIGHT_MODULE || "playwright");
  const staticFiles = new Map();
  const names = ["index.html", "verifier.js", "images.js", "ui.js", "style.css"];
  for (const name of names) staticFiles.set(`/public/license-verifier/${name}`, readFileSync(join(root, "public/license-verifier", name)));
  for (const name of ["index.html", "issuer-ui.js", "licensePayload.js"]) staticFiles.set(`/授权/${name}`, readFileSync(join(root, "授权", name)));
  for (const name of ["license.js", "licenseBranding.js"]) staticFiles.set(`/src/core/${name}`, readFileSync(join(root, "src/core", name)));
  const denied = [];
  const server = createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    if (!staticFiles.has(pathname)) { denied.push(pathname); res.writeHead(404).end(); return; }
    res.setHeader("Content-Type", pathname.endsWith(".js") ? "text/javascript; charset=utf-8" : pathname.endsWith(".css") ? "text/css; charset=utf-8" : "text/html; charset=utf-8");
    res.end(staticFiles.get(pathname));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const engineArg = process.argv.indexOf("--engine"), engineName = engineArg >= 0 ? process.argv[engineArg + 1] : "chromium";
  const channelArg = process.argv.indexOf("--channel"), channel = channelArg >= 0 ? process.argv[channelArg + 1] : undefined;
  let browser;
  try {
    browser = await pw[engineName].launch({ headless: true, ...(channel ? { channel } : {}) });
    const context = await browser.newContext({ acceptDownloads: true });
    const errors = [], requests = [];
    context.on("page", page => page.on("pageerror", error => errors.push(error.message)));
    context.on("request", req => requests.push(req.url()));
    const page = await context.newPage();
    async function upload(selector, name, buffer, mimeType = "application/octet-stream") { await page.locator(selector).setInputFiles({ name, buffer, mimeType }); }
    for (const protocol of ["http", "file"]) {
      const url = protocol === "http" ? `${base}/public/license-verifier/index.html` : pathToFileURL(join(root, "public/license-verifier/index.html")).href;
      await page.goto(url); await page.waitForFunction(() => document.getElementById("fingerprint").textContent.length === 64);
      check(await page.locator("#fingerprint").textContent() === fingerprint, `${protocol} embedded key fingerprint`);
      await upload("#license-file", "legacy.bin", samples[0]); await page.click("#verify");
      await page.waitForFunction(() => document.getElementById("status").textContent.startsWith("签名有效"));
      check((await page.locator("#details").textContent()).includes(hash(samples[0])), `${protocol} legacy verify`);
      await page.fill("#public-key", keys.publicKey);
      await upload("#license-file", "test.bin", Buffer.from(newBin)); await page.click("#verify");
      await page.waitForFunction(() => document.querySelectorAll("#branding img").length === 2);
      check((await page.locator("#key-kind").textContent()).includes("用户提供"), `${protocol} custom key marked`);
      await upload("#license-file", "bad.bin", Buffer.from(tampered)); await page.click("#verify");
      await page.waitForFunction(() => document.getElementById("status").textContent.includes("SIGNATURE_INVALID"));
      check(await page.locator("#payload").textContent() === "", `${protocol} tampered payload not shown`);
      const badImageBin = rawSign(JSON.stringify({ ...testConfig, appIcon: `data:image/png;base64,${png(2, 2, true).toString("base64")}`, ext: null }));
      await upload("#license-file", "bad-image.bin", Buffer.from(badImageBin)); await page.click("#verify");
      await page.waitForFunction(() => document.getElementById("details").textContent.includes("IMAGE_DECODE"), null, { timeout: 8000 }).catch(async () => {
        throw new Error(JSON.stringify({ status: await page.locator("#status").textContent(), details: await page.locator("#details").textContent() }));
      });
      check((await page.locator("#status").textContent()).startsWith("签名有效") && await page.locator("#branding img").count() === 0, `${protocol} decoder damage fallback independent of signature`);
      for (const width of [320, 1440]) { await page.setViewportSize({ width, height: 900 }); check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${protocol} layout ${width}`); }
      browserResults.push({ engine: engineName, protocol, result: "PASS" });
    }
    await page.goto(`${base}/授权/index.html`);
    await page.waitForFunction(() => document.getElementById("f-appname").value === "码小妹");
    check(await page.locator("#f-to").inputValue() === "", "issuer no default real recipient");
    check(await page.locator("textarea#f-ext").count() === 0, "no huge JSON editor");
    await page.fill("#f-to", "TEST FIXTURE");
    await upload("#app-icon-input", "test.png", image, "image/png");
    await page.waitForFunction(() => document.querySelectorAll("#preview img.app-icon").length === 1);
    await upload("#ext-img-input", "test.png", image, "image/png");
    await page.waitForFunction(() => document.querySelectorAll("#preview img").length === 2);
    const jpeg = await page.evaluate(() => {
      const canvas = document.createElement("canvas"); canvas.width = canvas.height = 3;
      canvas.getContext("2d").fillRect(0, 0, 3, 3); return canvas.toDataURL("image/jpeg");
    });
    check(inspectRaster(Buffer.from(jpeg.split(",")[1], "base64"), "icon", "image/jpeg").width === 3, "JPEG real browser encoder -> core scanner");
    throws(() => inspectRaster(Buffer.from(jpeg.split(",")[1], "base64").subarray(0, -2)), /IMAGE_CORRUPT/, "JPEG missing EOI");
    await upload("#app-icon-input", "test.jpg", Buffer.from(jpeg.split(",")[1], "base64"), "image/jpeg");
    await page.waitForFunction(() => document.querySelector("#preview img.app-icon")?.naturalWidth === 3);
    check(await page.locator("#preview img.app-icon").evaluate(img => img.naturalWidth === 3 && img.complete), "JPEG upload and decoded preview");
    await upload("#app-icon-input", "test.png", image, "image/png");
    await page.waitForFunction(() => document.querySelector("#preview img.app-icon")?.naturalWidth === 2);
    await upload("#app-icon-input", "bad.svg", Buffer.from("<svg/>"), "image/svg+xml");
    await page.waitForFunction(() => document.getElementById("form-status").textContent.includes("IMAGE_TYPE"));
    check(await page.locator("#preview img.app-icon").count() === 1, "invalid upload preserves previous image");
    const exported = page.waitForEvent("download"); await page.click("#export-config");
    const configDownload = await exported, configStream = await configDownload.createReadStream(), configChunks = [];
    for await (const chunk of configStream) configChunks.push(chunk);
    const exportedConfig = JSON.parse(Buffer.concat(configChunks).toString("utf8"));
    check(exportedConfig.licensedTo === "TEST FIXTURE" && exportedConfig.appIcon.startsWith("data:image/png"), "export form and images");
    // Test encrypted custody with synthetic AES-GCM envelope, never a production key file.
    const pass = "synthetic-test-password", salt = Buffer.alloc(16, 17), iv = Buffer.alloc(12, 23);
    const baseKey = await webcrypto.subtle.importKey("raw", new TextEncoder().encode(pass), "PBKDF2", false, ["deriveKey"]);
    const aes = await webcrypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: 250000, hash: "SHA-256" }, baseKey, { name: "AES-GCM", length: 256 }, false, ["encrypt"]);
    const ct = await webcrypto.subtle.encrypt({ name: "AES-GCM", iv }, aes, new TextEncoder().encode(keys.privateKey));
    const syntheticEnc = Buffer.from(JSON.stringify({ salt: salt.toString("base64"), iv: iv.toString("base64"), ct: Buffer.from(ct).toString("base64") }));
    await upload("#key-input", "synthetic.enc", syntheticEnc, "application/json");
    await page.fill("#f-pass", "wrong"); await page.click("#unlock-btn");
    await page.waitForFunction(() => document.getElementById("key-status").textContent.startsWith("解锁失败"));
    check(await page.locator("#sign-btn").isDisabled(), "wrong password cannot sign");
    await page.fill("#f-pass", pass); await page.click("#unlock-btn");
    await page.waitForFunction(() => !document.getElementById("sign-btn").disabled);
    check(await page.locator("#f-pass").inputValue() === "", "password cleared");
    await page.click("#sign-btn"); await page.waitForFunction(() => document.getElementById("result-title").textContent === "签发成功");
    const browserBin = await page.locator("#dl-link").evaluate(async link => (await fetch(link.href)).text());
    check((await verifyLicense(browserBin, { publicKey: keys.publicKey })).payload.appIcon.startsWith("data:image/png"), "browser issuer -> reader verification");
    const appLoad = await page.evaluate(async ({ base, bin, key }) => {
      const core = await import(`${base}/src/core/license.js`), branding = await import(`${base}/src/core/licenseBranding.js`);
      const lic = await core.loadLicense({ publicKey: key, fetchImpl: async () => ({ ok: true, text: async () => bin }) });
      const safe = branding.resolveLicenseBranding(lic); return { verified: lic.verified, icon: safe.appIcon?.width, name: safe.appName };
    }, { base, bin: browserBin, key: keys.publicKey });
    check(appLoad.verified && appLoad.icon === 2 && appLoad.name === "码小妹", "actual browser ESM imports and application interface");
    const decodedFallback = await page.evaluate(async ({ base, bin, key }) => {
      const core = await import(`${base}/src/core/license.js`), branding = await import(`${base}/src/core/licenseBranding.js`);
      const lic = await core.loadLicense({ publicKey: key, fetchImpl: async () => new Response(bin) });
      const safe = await branding.prepareLicenseBranding(lic); return { verified: lic.verified, icon: safe.appIcon, warnings: safe.warnings };
    }, { base, bin: rawSign(JSON.stringify({ ...testConfig, appIcon: badStream })), key: keys.publicKey });
    check(decodedFallback.verified && decodedFallback.icon === null && decodedFallback.warnings.includes("appIcon:IMAGE_DECODE"), "application async branding fallback via real ESM");
    await page.fill("#f-note", "changed"); check(await page.locator("#dl-link").isHidden(), "edit invalidates signed download");
    await page.click("#remove-icon"); await page.waitForFunction(() => !document.querySelector("#preview img.app-icon"));
    check(await page.locator("#preview img").count() === 1, "remove icon leaves feed image");
    await page.click("#remove-feed"); await page.waitForFunction(() => !document.querySelector("#preview img"));
    await upload("#config-input", "legacy.bin", samples[0]);
    await page.waitForFunction(() => document.getElementById("form-status").textContent.startsWith("已导入"));
    check((await page.locator("#form-status").textContent()).includes("未知字段保留"), "real legacy import without signing");
    await upload("#config-input", "old.json", Buffer.from(JSON.stringify({ ...testConfig, unknownField: { preserved: true } })), "application/json");
    await page.waitForFunction(() => document.getElementById("f-appname").value === "TEST BRAND");
    const exportedAgain = page.waitForEvent("download"); await page.click("#export-config");
    const importedStream = await (await exportedAgain).createReadStream(), importedChunks = [];
    for await (const chunk of importedStream) importedChunks.push(chunk);
    check(JSON.parse(Buffer.concat(importedChunks)).unknownField.preserved, "legacy config unknown fields survive export");
    for (const width of [320, 1440]) { await page.setViewportSize({ width, height: 900 }); check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `issuer layout ${width}`); }
    await page.goto(pathToFileURL(join(root, "授权/index.html")).href);
    await page.waitForFunction(() => document.getElementById("f-appname").value === "码小妹");
    await page.fill("#f-to", "TEST PEM ONLY");
    await upload("#key-input", "synthetic.pem", Buffer.from(keys.privateKey), "text/plain");
    await page.waitForFunction(() => document.getElementById("key-status").textContent.includes("明文私钥"));
    await page.click("#unlock-btn"); await page.waitForFunction(() => !document.getElementById("sign-btn").disabled);
    await page.click("#sign-btn"); await page.waitForFunction(() => document.getElementById("result-title").textContent === "签发成功");
    const pemBin = await page.locator("#dl-link").evaluate(async link => (await fetch(link.href)).text());
    check((await verifyLicense(pemBin, { publicKey: keys.publicKey })).payload.licensedTo === "TEST PEM ONLY", "file issuer plain PEM fallback with test key");
    check(!requests.some(url => /private_key|https:\/\//.test(url)), "no production key or external request");
    check(denied.every(path => path === "/favicon.ico"), "HTTP fixture only serves exact allowlist");
    check(errors.length === 0, `browser pageerrors: ${errors.join(";")}`);
    await context.close(); browserResults.push({ engine: engineName, entry: "issuer", result: "PASS" });
  } finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)); }
}
// Re-read only the same legacy files, proving byte identity after all checks.
for (const [index, name] of readdirSync(sampleDir).filter(name => name.startsWith("license.bin")).sort().entries())
  check(hash(readFileSync(join(sampleDir, name))) === sampleResults[index].sha256, "legacy file unchanged");
console.log(JSON.stringify({ result: "PASS", checks: count, runtime: process.version, publicKeySpkiSha256: fingerprint,
  legacyCount: samples.length, legacy: sampleResults, browser: browserResults.length ? browserResults : "未测（加 --browser）" }, null, 2));
