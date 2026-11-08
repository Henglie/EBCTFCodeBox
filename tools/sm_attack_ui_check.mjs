import assert from "node:assert/strict";
import { createRequire } from "node:module";
import edu from "../src/core/edu/edu-sm-attacks.js";
import english from "../src/core/edu-en/edu-sm-attacks.en.js";
const option = (key, fallback) => process.argv.includes(key) ? process.argv[process.argv.indexOf(key) + 1] : fallback;
const pw = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || "playwright");
const engine = option("--browser", "chromium"), channel = option("--channel", undefined), base = option("--base-url", "http://127.0.0.1:8180/");
assert(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
const browser = await pw[engine].launch({ headless: true, ...(channel ? { channel } : {}) });
let checks = 0;
const check = (condition, label) => { assert(condition, label); checks++; };
const context = await browser.newContext({ viewport: { width: 1366, height: 768 }, serviceWorkers: "block" });
await context.route(/^https?:\/\/(?:127\.0\.0\.1|localhost):8181\//, route => route.fulfill({ status: 503, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*", "Cross-Origin-Resource-Policy": "cross-origin" }, body: '{"error":"bridge unavailable in frontend test"}' }));
await context.addInitScript(() => localStorage.setItem("ebctf_locale", "zh"));
const page = await context.newPage(), errors = [];
page.on("pageerror", e => errors.push(e.message));
const c2 = edu.sm2KnownPlaintext.examples[0].in;
const c1 = edu.sm2KnownPlaintext.examples[0].param.match(/knownCipher=(.*?);/)[1];
const fixtures = {
  sm2KnownPlaintext: { input: c2, params: { knownCipher: c1, known: "known plaintext!" }, expected: "UTF-8: flag{sm2_reuse!}", file: true },
  sm2NonceRecover: { input: edu.sm2NonceRecover.examples[0].in, params: { attackMode: "known" }, expected: "d = " + "0".repeat(63) + "1" },
  sm2LeakedK: { input: c2, params: { k: "1", publicKey: c2.slice(0, 130) }, expected: "UTF-8: flag{sm2_reuse!}", file: true },
  sm3LengthExtension: { input: "d", params: { digest: "66c7f0f462eeedd9d1f2d46bdc10e4e24167c4875cf2f7a2297da02b8f4ba8e0", originalLength: "3" }, expected: "631665d64651d487cb4a1efd330705bf5151b3e0db48691b62681d0758784e0f", file: true },
  sm4CtrReuse: { input: "01000302", params: { cipher1: "00010203", known: "61626364" }, expected: "Hex: 60636265", file: true },
  zucNonceReuse: { input: "01000302", params: { cipher1: "00010203", known: "61626364" }, expected: "Hex: 60636265", file: true },
  sm4CbcBitflip: { input: "00".repeat(16) + "681edf34d206965e86b3e94f536e4246", params: { known: "01", desired: "00" }, expected: "01" + "00".repeat(15) + "681edf34d206965e86b3e94f536e4246", file: true },
  sm4EcbCodebook: { input: "681edf34d206965e86b3e94f536e4246", params: { pairs: "0123456789abcdeffedcba9876543210|681edf34d206965e86b3e94f536e4246" }, expected: "0: 0123456789abcdeffedcba9876543210", file: true },
  sm4GcmForgery: { input: edu.sm4GcmForgery.examples[0].in, params: { newCt: "db35523d5dab1036c50e037da11234e7ee" }, expected: "5ba2ff5ecca5a2b463e2914d481b4cda" },
};
try {
  let navigation = 0;
  for (const [id, fixture] of Object.entries(fixtures)) {
    await page.goto(new URL(`?attack-check=${++navigation}#/op/${id}`, base).href);
    await page.locator("#ioIn").waitFor();
    for (const [key, value] of Object.entries(fixture.params)) {
      const field = page.locator(`#p_${key}`);
      if (await field.evaluate(n => n.tagName === "SELECT")) await field.selectOption(value);
      else await field.fill(value);
    }
    if (fixture.input.includes("\n")) {
      await page.locator("#ioIn").focus();
      await page.locator("#ioIn").evaluate((node, text) => {
        const event = new Event("paste", { bubbles: true, cancelable: true });
        Object.defineProperty(event, "clipboardData", { value: { getData: () => text } });
        node.dispatchEvent(event);
      }, fixture.input);
    } else await page.locator("#ioIn").fill(fixture.input);
    check(await page.locator("#ioIn").evaluate((node, text) => node.value === text, fixture.input), `${id}: literal input retained`);
    await page.locator(".io-actions .primary").click();
    await page.locator('.op-feedback[data-state="success"]').waitFor();
    check((await page.locator("#ioOut").textContent()).includes(fixture.expected), `${id}: real output`);
    if (fixture.file) check(await page.locator(".io-out-files button").count() > 0, `${id}: binary download available`);
    await page.locator(".edu-card").waitFor();
    check((await page.locator(".edu-card").textContent()).includes(edu[id].what), `${id}: actual edu wired`);
    check(new Set(edu[id].aka).size >= 10 && new Set(english[id].aka).size >= 10, `${id}: aliases in both languages`);
  }
  for (const [query, id] of [["SM2 KPA", "sm2KnownPlaintext"], ["SM3 length extension", "sm3LengthExtension"], ["SM4 CBC bit flipping", "sm4CbcBitflip"]]) {
    await page.locator("#opSearchInput").fill(query);
    const result = page.locator(`.op-search-item`).filter({ hasText: id.startsWith("sm3") ? "SM3" : id.startsWith("sm2") ? "SM2" : "SM4" }).first();
    await result.waitFor(); await result.click();
    await page.waitForURL(new RegExp(`#/op/${id}$`));
    await page.locator(`#ci_enable_${id}`).waitFor({ state: "attached" });
    check(true, `${query}: alias search and actual navigation`);
  }
  await page.goto(new URL("?real-sm2=1#/op/sm2KnownPlaintext", base).href);
  await page.locator("#p_cipherFormat").selectOption("c2");
  await page.locator("#p_knownCipher").fill("e974cf39fa4541dd928300e690552e02e1bfe8b4a3aaeac939b2767f24605605d79094ffad371c637fc4912f1fd06a1a8e2fccdf1ee9b4ab9f2ac0cdc199");
  await page.locator("#p_known").fill("Welcome to the Hefei High-Tech Zone Cybersecurity Competition.");
  await page.locator("#ioIn").fill("d87dc23dee4a1dc8d1df41f6c9083a28b2eeecbfe284b39c35fb102e243e473c819dc0e98b33");
  await page.locator(".io-actions .primary").click();
  await page.locator('.op-feedback[data-state="success"]').waitFor();
  const flag = "flag{b9573ad184b67abaf02dd24c61c9c16e}";
  check((await page.locator("#ioOut").textContent()).includes(`UTF-8: ${flag}`), "User real challenge solved through production UI");
  check((await page.locator("#ioOut").textContent()).includes("C1 checked: false"), "C2-only does not overclaim C1 validation");
  const downloaded = page.waitForEvent("download");
  await page.locator(".io-out-files button").click();
  const download = await downloaded;
  const stream = await download.createReadStream(), chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  const bytes = Buffer.concat(chunks);
  check(bytes.length === 38 && bytes.toString("ascii") === flag, "Downloaded 38-byte plaintext is exact");
  check(await page.locator(".io-pane-input .io-coding-view").count() === 4, "Exactly four input views, no hidden extra menu");
  check(errors.length === 0, `No page errors: ${errors.join(";")}`);
  console.log(JSON.stringify({ engine, checks, operations: Object.keys(fixtures).length, verdict: "PASS" }));
} catch (error) { console.error(await page.evaluate(() => ({ route: location.hash, input: document.getElementById("ioIn")?.value, output: document.getElementById("ioOut")?.value, fields: [...document.querySelectorAll('.op-config input[id^="p_"],.op-config textarea,.op-config select')].map(n => [n.id,n.value]) }))); throw error; }
finally { await context.close(); await browser.close(); }
