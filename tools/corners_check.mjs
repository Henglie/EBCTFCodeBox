// Geometry only: node tools/corners_check.mjs
// Real DOM pixels (use the existing development server; no server is started):
//   node tools/corners_check.mjs --base-url http://127.0.0.1:<port>/ --browser firefox
//   node tools/corners_check.mjs --base-url http://127.0.0.1:<port>/ --browser webkit
//   node tools/corners_check.mjs --base-url http://127.0.0.1:<port>/ --channel msedge
// PLAYWRIGHT_MODULE may name an installed Playwright package directory. It is
// development-only. Optional --screenshots-dir must name an existing directory.
// Add --app-perf to also measure real #/all discovery/IO/scrolling on 969 cards.
// Fixtures run in an isolated page, fetch the actual module/CSS from base-url,
// and never load an application profile, start a server or register a worker.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { statSync } from 'node:fs';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { CORNER_EXPONENT, cornerCubics, continuousCornerPath, createCornerSVG, normalizeRadii, splitCSS } from '../src/ui/continuousCorners.js';

const option = (key, fallback) => { const i = process.argv.indexOf(key); return i < 0 ? fallback : process.argv[i + 1]; };
let checks = 0;
const check = (condition, label) => { assert(condition, label); checks++; };
const close = (a, b, epsilon = 1e-10) => Math.abs(a - b) < epsilon;
const cubic = (p, t) => [0, 1].map(axis => p.reduce((s, point, i) => s + [1, 3, 3, 1][i] * t ** i * (1 - t) ** (3 - i) * point[axis], 0));
const derivative = (p, end) => end ? p[3].map((v, i) => 3 * (v - p[2][i])) : p[1].map((v, i) => 3 * (v - p[0][i]));
const second = (p, end) => end ? p[3].map((v, i) => 6 * (v - 2 * p[2][i] + p[1][i])) : p[2].map((v, i) => 6 * (v - 2 * p[1][i] + p[0][i]));
const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
const [first, last] = cornerCubics();
check(first.flat().every(Number.isFinite) && last.flat().every(Number.isFinite), 'Finite cubic controls');
check(close(cross(derivative(first, false), second(first, false)), 0), 'Zero start curvature at straight edge');
check(close(cross(derivative(last, true), second(last, true)), 0), 'Zero end curvature at straight edge');
check(first[3].every((v, i) => close(v, last[0][i])), 'C0 at diagonal');
check(derivative(first, true).every((v, i) => close(v, derivative(last, false)[i])), 'C1 at diagonal');
check(second(first, true).every((v, i) => close(v, second(last, false)[i])), 'C2 at diagonal');
check(close(first[3][0] ** CORNER_EXPONENT + (1 - first[3][1]) ** CORNER_EXPONENT, 1), 'Native superellipse(1.5) diagonal');
let maxRadialError = 0;
for (const points of [first, last]) for (let i = 0; i <= 10000; i++) {
  const [x, y] = cubic(points, i / 10000);
  const error = Math.abs((x ** CORNER_EXPONENT + (1 - y) ** CORNER_EXPONENT) ** (1 / CORNER_EXPONENT) - 1);
  maxRadialError = Math.max(maxRadialError, error);
}
check(maxRadialError < .008, `Native Lamé radial deviation < 0.8% radius (${maxRadialError})`);
check(normalizeRadii(80, 20, [999, 999, 999, 999]).every(r => r.every(v => close(v, 10))), 'CSS overlapping-radius common scale');
check(normalizeRadii(100, 60, [[70, 40], [30, 10], [10, 20], [20, 30]])[0][1] < 40, 'Asymmetric elliptical-radius normalization');
const path = continuousCornerPath(120, 60, [[20, 12], [0, 0], [18, 18], [8, 8]]);
check(!/NaN|Infinity|undefined/.test(path) && path.endsWith('Z'), 'Asymmetric/square corners form a closed finite path');
check(continuousCornerPath(0, 50, [2, 2, 2, 2]) === '', 'Empty geometry');
check(splitCSS('rgb(1, 2, 3), linear-gradient(red, blue), url("a,b")').length === 3, 'Nested CSS list splitting');
const paint = { width: 160, height: 96, radii: [32, 32, 32, 32], background: '#2468ac' };
const colored = createCornerSVG({ ...paint, border: [1, 2, 3, 4], borderColors: ['red', 'green', 'blue', 'black'] });
check((colored.svg.match(/clip-path="url\(#b/g) || []).length === 4, 'Four independently colored border sides');
check(createCornerSVG({ ...paint, shadow: 'rgba(0, 0, 0, .4) 0px 5px 12px 2px' }).outset >= 25, 'Shadow has an outside paint area');
check(createCornerSVG({ ...paint, shadow: 'inset rgb(0, 0, 0) 2px 0px 0px 0px' }).svg.includes('mask="url(#i0)"'), 'Inset shadow mask');
check(createCornerSVG({ ...paint, image: 'linear-gradient(to right, red 0% 25%, blue 25% 100%)' }).svg.includes('offset="0.25"'), 'Hard gradient stops');
check(createCornerSVG({ ...paint, image: 'linear-gradient(135deg, red, green, blue)' }).svg.includes('offset="0.5"'), 'Implicit gradient stops');
check(createCornerSVG({ ...paint, image: 'linear-gradient(45deg, red 25%, transparent 25%), linear-gradient(135deg, blue 75%, transparent 75%)', size: '16px 16px', position: '0px 0px, 8px 8px' }).svg.includes('id="p1"'), 'Repeated positioned gradient tiles');
check(createCornerSVG({ ...paint, image: 'linear-gradient(red, blue)', size: '8px 8px', position: '50% 50%', repeat: 'no-repeat' }).svg.includes('clip-path="url(#tile0)"'), 'Nonrepeating positioned gradient tile');
check(createCornerSVG({ ...paint, border: [2, 2, 2, 2], borderStyles: Array(4).fill('dashed') }).svg.includes('stroke-dasharray'), 'Dashed border geometry');
assert.throws(() => createCornerSVG({ ...paint, image: 'url("not-loaded.png")' }), /background-image/); checks++;
assert.throws(() => createCornerSVG({ ...paint, image: 'linear-gradient(red, blue)', size: 'min(100%, 8px) 8px' }), /background-size|background-placement/); checks++;
assert.throws(() => createCornerSVG({ ...paint, shadow: 'black 0px 0px 5000px 0px' }), /shadow-budget/); checks++;
check(!createCornerSVG({ ...paint, background: '"/><script>alert(1)</script>' }).svg.includes('<script>'), 'Paint is XML escaped');
const selectPaint = { ...paint, padding: [12, 12, 12, 12], select: { gutter: 18, color: '#008800' } };
check(createCornerSVG(selectPaint).svg.includes('stroke="#008800"'), 'Select chevron uses source foreground color');
check(createCornerSVG({ ...selectPaint, direction: 'rtl' }).svg.includes('M17 46L21 50L25 46'), 'Select chevron mirrors into logical end gutter');
check(createCornerSVG({ ...paint, image: 'linear-gradient(45deg, transparent 50%, green 50%)', size: '5px 5px', position: 'calc(100% - 16px) 50%', repeat: 'no-repeat' }).svg.includes('x="139"'), 'Authored select arrow supports linear calc end placement');
console.log(`Geometry: ${checks} PASS; max normalized radial deviation ${maxRadialError.toFixed(8)} (${(maxRadialError * 28).toFixed(3)}px at radius 28)`);

const base = option('--base-url', undefined);
if (!base) {
  console.log('Browser pixels: NOT RUN (supply --base-url and --browser firefox/webkit)');
} else {
  const url = new URL(base);
  check(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname), 'Local test origin');
  const require = createRequire(import.meta.url);
  const pw = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
  const engine = option('--browser', 'chromium'), channel = option('--channel', undefined);
  check(['chromium', 'firefox', 'webkit'].includes(engine), 'Known browser engine');
  const shots = option('--screenshots-dir', undefined);
  if (shots) check(statSync(shots).isDirectory(), 'Existing screenshot directory');
  const browser = await pw[engine].launch({ headless: true, ...(channel ? { channel } : {}) });
  const context = await browser.newContext({ viewport: { width: 1100, height: 900 }, deviceScaleFactor: 1, serviceWorkers: 'block', reducedMotion: 'reduce' });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const testURL = new URL('__continuous-corners-check__', base).href;
  const moduleURL = new URL('src/ui/continuousCorners.js', base).href;
  const fixture = `<!doctype html><html><head><meta charset="utf-8">
    <link rel="stylesheet" href="${new URL('src/ui/controls.css', base).href}">
    <link rel="stylesheet" href="${new URL('src/ui/continuousCorners.css', base).href}">
    <style>
    *{box-sizing:border-box}html,body{margin:0;background:white;color:black;font:14px sans-serif}
    :root{--primary:#8f3d33;--surface-2:#eee;--range-track:#aaa;--test-fill:#2468ac;--r-full:999px;--fs-sm:14px;--control-track:#ddd;--dur-short:0ms;--dur-3:0ms}
    html.dark{--test-fill:#21354a;--primary:#f0b3a7;--surface-2:#333;--range-track:#666}
    @supports(corner-shape:superellipse(1.5)){*{corner-shape:superellipse(1.5)}.cc-circle{corner-shape:round}}
    #fixture{position:relative;width:1100px;min-height:900px}
    .cc-panel{position:absolute;left:40px;top:40px;width:160px;height:96px;border-radius:32px;background:var(--test-fill)}
    #ordinary{left:240px;corner-shape:round}
    #button{position:absolute;left:40px;top:180px;width:160px;height:64px;background:#2468ac;border:2px solid #b3261e;border-radius:20px;box-shadow:0 6px 12px rgba(0,0,0,.35);color:white}
    #button:hover{background:#28793c;border-color:#793cb0;box-shadow:0 0 0 4px #ccc}
    #button:active{background:#aa7700}
    #button:focus-visible{outline:3px solid #008800;outline-offset:3px}
    #field{position:absolute;left:240px;top:180px;width:200px;height:64px;border:2px solid #b3261e;background:#eef5ff;border-radius:20px;padding:12px;font:inherit}
    #field:focus{outline:2px solid #008800;outline-offset:3px;box-shadow:0 0 0 3px #cceecc}
    #floating-host{position:absolute;left:40px;top:290px;width:160px;height:80px;background:#ddd;border-radius:24px;overflow:visible}
    #floating{position:absolute;left:130px;top:20px;width:160px;height:80px;background:#346734;border-radius:20px;z-index:10}
    #circle{position:absolute;left:450px;top:40px;width:80px;height:80px;border-radius:50%;background:#2468ac}
    #segments{position:absolute;left:40px;top:400px;width:300px;height:48px}
    #segments .m3-segment-thumb{top:4px;left:4px;width:90px;height:40px}
    #range{position:absolute;left:40px;top:490px;width:240px;--range-progress:25%}
    #scroller{position:absolute;left:600px;top:40px;width:300px;height:200px;overflow:auto;background:#fafafa}
    #scrolled{margin:500px 10px 10px;width:160px;height:96px;border-radius:32px;background:#2468ac}
    #gradient{position:absolute;left:400px;top:290px;width:160px;height:80px;border-radius:24px;background:linear-gradient(to right,#2468ac 0% 50%,#aabbcc 50% 100%);box-shadow:inset 0 0 0 3px #b3261e}
    #tiles{position:absolute;left:400px;top:400px;width:160px;height:64px;border-radius:20px;background-image:linear-gradient(to right,#2468ac 50%,#aabbcc 50%);background-size:16px 16px;background-position:8px 0px}
    #dense{position:absolute;left:600px;top:280px;width:320px;height:240px;overflow:auto;display:grid;grid-template-columns:repeat(2,1fr);gap:4px}
    .cc-dense{height:60px;min-height:60px;background:#ddd;border-radius:16px}
    .cc-select{appearance:auto;position:absolute;top:600px;width:200px;height:64px;border:0;border-radius:28px;padding:12px;background:var(--test-fill);color:#008800;font:14px sans-serif}
    .cc-select:focus{outline:3px solid #008800;outline-offset:3px}
    #select{left:40px}#select-rtl{left:280px}#select-disabled{left:520px;opacity:.4}#select-auto{left:760px;width:auto;height:auto}
    #select-list{left:40px;top:700px}#select-image{left:280px;top:700px;background:radial-gradient(#2468ac,#aabbcc)}
    #select-custom{left:520px;top:700px;appearance:none;padding-right:32px;background-image:linear-gradient(45deg,transparent 50%,#008800 50%),linear-gradient(135deg,#008800 50%,transparent 50%);background-position:calc(100% - 18px) 50%,calc(100% - 13px) 50%;background-size:5px 5px;background-repeat:no-repeat}
    </style></head><body><div id="fixture">
    <div id="panel" class="cc-panel"></div><div id="ordinary" class="cc-panel" data-continuous-corners="off"></div>
    <div id="circle" class="cc-circle"></div><button id="button">Action</button><input id="field" value="original">
    <div id="floating-host"><button id="floating">Floating</button></div>
    <div id="segments" class="m3-segmented"><span class="m3-segment-thumb"></span><button>A</button><button>B</button></div>
    <input id="range" class="m3-slider" type="range" min="0" max="100" value="25">
    <div id="scroller"><div id="scrolled"></div></div><div id="gradient"></div><div id="tiles"></div><div id="dense"></div>
    <select id="select" class="cc-select"><option value="utf8">UTF-8</option><option value="utf16">UTF-16</option><option value="ascii">ASCII</option></select>
    <select id="select-rtl" class="cc-select" dir="rtl"><option value="utf8">UTF-8</option><option value="ascii">ASCII</option></select>
    <select id="select-disabled" class="cc-select" disabled><option>Disabled</option></select>
    <select id="select-auto" class="cc-select"><option>Unicode ASCII</option><option>UTF-8</option></select>
    <select id="select-list" class="cc-select" multiple size="2"><option>A</option><option>B</option></select>
    <select id="select-image" class="cc-select"><option>Native image</option></select>
    <select id="select-custom" class="cc-select"><option>Styled arrow</option><option>Other</option></select>
    </div></body></html>`;
  await page.route(testURL, route => route.fulfill({ contentType: 'text/html', body: fixture }));
  const settle = async () => {
    await page.waitForTimeout(100); // IO delivery, style computation and SVG decode.
    await page.waitForFunction(() => !window.cornerTest?.stats().pending);
    await page.waitForTimeout(50);
  };
  const pixels = async () => decodePNG(await page.screenshot());
  const rect = selector => page.locator(selector).evaluate(node => { const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
  const blue = p => p[2] > 130 && p[0] < 80 && p[1] > 60 && p[1] < 150;
  const white = p => p.slice(0, 3).every(v => v > 245);
  try {
    await page.goto(testURL);
    await page.evaluate(async moduleURL => {
      window.cornerModule = await import(moduleURL);
      window.cornerNative = window.cornerModule.setupContinuousCorners({ root: document.getElementById('fixture') });
    }, moduleURL);
    await settle();
    const native = await page.evaluate(() => window.cornerNative.mode === 'native');
    if (native) {
      const image = await pixels();
      check(blue(image.at(48, 48)) && white(image.at(248, 48)), 'Native Chromium pixels differ from ordinary round corner');
    }
    await page.evaluate(() => {
      window.cornerNative.dispose();
      window.beforeNodes = document.getElementById('fixture').querySelectorAll('*').length;
      window.beforeButton = document.getElementById('button').getBoundingClientRect().toJSON();
      window.beforeSelects = Object.fromEntries(['select', 'select-rtl', 'select-disabled', 'select-auto', 'select-image', 'select-custom'].map(id => {
        const node = document.getElementById(id), style = getComputedStyle(node);
        return [id, { rect: node.getBoundingClientRect().toJSON(), padding: [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft], appearance: style.appearance, opacity: style.opacity }];
      }));
      window.cornerTest = window.cornerModule.setupContinuousCorners({ root: document.getElementById('fixture'), force: true });
    });
    await page.waitForFunction(() => document.getElementById('panel').hasAttribute('data-cc-rendered'));
    await settle();
    let image = await pixels();
    check(blue(image.at(48, 48)), 'Self-drawn actual DOM corner contains the superellipse-only pixel');
    check(white(image.at(248, 48)), 'Ordinary border-radius negative control excludes the same pixel');
    check(white(image.at(41, 41)), 'Self-drawn curve excludes the square-corner pixel');
    let contour = 0;
    for (let y = 1; y < 32; y += 2) for (let x = 1; x < 32; x += 2) {
      const radial = (((32 - x - .5) / 32) ** CORNER_EXPONENT + ((32 - y - .5) / 32) ** CORNER_EXPONENT) ** (1 / CORNER_EXPONENT);
      if (Math.abs(radial - 1) < .06) continue;
      check(radial < 1 ? blue(image.at(40 + x, 40 + y)) : white(image.at(40 + x, 40 + y)), `Independent Lamé contour pixel (${x},${y})`);
      contour++;
    }
    check(contour > 150, 'Curvature checked against independent numerical contour, not class labels');
    check(await page.evaluate(() => document.getElementById('fixture').querySelectorAll('*').length === window.beforeNodes), 'Renderer adds no DOM children');
    check(await page.evaluate(() => {
      const a = document.getElementById('button').getBoundingClientRect(), b = window.beforeButton;
      return ['x', 'y', 'width', 'height'].every(k => a[k] === b[k]);
    }), 'Button layout is exactly preserved');
    check(await page.locator('#circle').evaluate(node => !node.hasAttribute('data-cc-rendered')), 'Semantic circle is not self-drawn');
    check(white(image.at(458, 48)), 'Circle stays circular in rendered pixels');
    check(image.at(120, 181)[0] > 140 && image.at(120, 181)[1] < 80, 'Authored red border rendered');
    check(!white(image.at(120, 249)), 'Outer elevation shadow extends beyond the host');
    check(blue(image.at(420, 330)) && image.at(540, 330)[0] > 150, 'Linear-gradient source paint preserved');
    check(blue(image.at(410, 432)) && image.at(402, 432)[0] > 150, 'Positioned repeated gradient tiles preserve actual pixels');
    check(image.at(480, 291)[0] > 130 && image.at(480, 291)[1] < 100, 'Inset shadow is visible');
    check(blue(image.at(47, 607)) && white(image.at(41, 601)), 'Select closed shell has continuous-curvature pixels');
    check(await page.locator('#select').evaluate(node => node.hasAttribute('data-cc-select') && getComputedStyle(node).appearance === 'none'), 'Successful select shell alone disables native appearance');
    for (const id of ['select', 'select-rtl', 'select-disabled', 'select-auto', 'select-custom']) {
      const size = await page.locator(`#${id}`).evaluate(node => {
        const actual = node.getBoundingClientRect(), before = window.beforeSelects[node.id].rect;
        const source = window.cornerTest.inspect(node).source, style = getComputedStyle(node);
        return { actual: { x: actual.x, y: actual.y, width: actual.width, height: actual.height }, before,
          height: { source: source.height, css: source.cssHeight, min: style.minHeight, box: style.boxSizing, appearance: source.appearance } };
      });
      check(['x', 'y', 'width', 'height'].every(k => Math.abs(size.actual[k] - size.before[k]) < .1), `${id}: native hit target/intrinsic size preserved ${JSON.stringify(size)}`);
      check(await page.locator(`#${id}`).evaluate(node => {
        const style = getComputedStyle(node), source = window.cornerTest.inspect(node).source;
        const start = style.direction === 'rtl' ? 1 : 3, current = [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft];
        return [0, 2, start].every(i => current[i] === window.beforeSelects[node.id].padding[i]) && source.padding.every((v, i) => v === parseFloat(window.beforeSelects[node.id].padding[i]));
      }), `${id}: authored block/start padding and source padding preserved`);
    }
    const green = p => p[1] > 65 && p[0] < 45 && p[2] < 45;
    const countPixels = (image, x, y, w, h, predicate) => { let count = 0; for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) if (predicate(image.at(x + dx, y + dy))) count++; return count; };
    check(countPixels(image, 200, 622, 38, 20, green) > 5, 'LTR select arrow is painted in right gutter');
    check(countPixels(image, 282, 622, 38, 20, green) > 5, 'RTL select arrow is painted in left gutter');
    check(await page.locator('#select-custom').evaluate(node => node.hasAttribute('data-cc-select')), 'Authored custom-arrow select also gets a continuous shell');
    check(countPixels(image, 680, 722, 38, 20, green) > 5, 'Existing CSS chevron is preserved in actual pixels');
    check(await page.locator('#select').evaluate(node => {
      const image = decodeURIComponent(node.style.getPropertyValue('--cc-image'));
      return !/<text|UTF-8|UTF-16|ASCII|utf8|utf16/.test(image);
    }), 'Select SVG never contains selected text or option values');
    check(await page.locator('#select-image').evaluate(node => !node.hasAttribute('data-cc-select') && getComputedStyle(node).appearance === window.beforeSelects[node.id].appearance && window.cornerTest.inspect(node).reason === 'background-image'), 'Unsupported radial select keeps native appearance');
    check(await page.locator('#select-list').evaluate(node => !node.hasAttribute('data-cc-select') && window.cornerTest.inspect(node).reason === 'native-listbox'), 'Multiple select/listbox remains native');
    await page.locator('#select').selectOption('utf16'); await settle();
    check(await page.locator('#select').inputValue() === 'utf16', 'Native selected value and selectOption semantics preserved');
    await page.locator('#select').selectOption('utf8');
    await page.locator('#select').focus();
    await page.locator('#select').press('ArrowDown'); await page.locator('#select').press('ArrowDown'); await page.locator('#select').press('Enter'); await page.locator('#select').press('Escape');
    await settle();
    check(['utf16', 'ascii'].includes(await page.locator('#select').inputValue()), 'Real keyboard opens/navigates/commits the native select');
    image = await pixels();
    check(green(image.at(140, 595)), 'Select focus outline remains visible outside SVG shell');
    await page.locator('#select-rtl').selectOption('ascii');
    check(await page.locator('#select-rtl').inputValue() === 'ascii', 'RTL select retains real selected value');
    check(await page.locator('#select-disabled').evaluate(node => { node.focus(); return node.disabled && document.activeElement !== node && getComputedStyle(node).opacity === window.beforeSelects[node.id].opacity; }), 'Disabled select preserves disabled/focus/opacity contract');
    await page.locator('#button').focus(); await settle(); image = await pixels();
    check(image.at(120, 175)[1] > 90 && image.at(120, 175)[0] < 40, 'Keyboard outline remains visible outside self-drawn button');
    await page.locator('#button').hover(); await settle(); image = await pixels();
    check(image.at(60, 210)[1] > image.at(60, 210)[0] * 1.5, 'Hover background updates actual pixels');
    check(image.at(120, 181)[2] > 100, 'Hover border updates actual pixels');
    await page.mouse.down(); await settle(); image = await pixels();
    check(image.at(60, 210)[0] > 140 && image.at(60, 210)[2] < 50, 'Pressed background updates actual pixels');
    await page.mouse.up(); await page.mouse.move(1000, 850);
    await page.locator('#field').fill('corner-input-value'); await settle();
    check(await page.locator('#field').inputValue() === 'corner-input-value', 'Native text input editing preserved');
    check(await page.locator('#field').evaluate(node => getComputedStyle(node).outlineStyle !== 'none'), 'Native input focus is not suppressed');
    check(await page.locator('#field').evaluate(node => !node.style.getPropertyValue('--cc-image').includes('corner-input-value')), 'SVG paint does not contain field text');
    check(await page.evaluate(() => document.elementFromPoint(320, 340)?.id === 'floating'), 'Floating menu is hit-testable beyond its parent');
    check(await page.locator('#floating-host').evaluate(node => getComputedStyle(node).clipPath === 'none' && getComputedStyle(node).overflow === 'visible'), 'Host has no clip-path or new overflow clipping');
    image = await pixels();
    check(!white(image.at(320, 340)), 'Floating menu pixels are not clipped');
    await page.locator('#panel').evaluate(node => { node.style.width = '212px'; node.style.height = '112px'; node.style.borderRadius = '24px'; });
    await settle(); image = await pixels();
    check((await rect('#panel')).width === 212 && blue(image.at(235, 96)) && blue(image.at(46, 46)), 'Resize redraw follows new size and smaller corner radius');
    await page.evaluate(() => document.documentElement.classList.add('dark')); await settle(); image = await pixels();
    check(image.at(100, 80)[0] === 33 && image.at(100, 80)[2] === 74, 'Theme change redraws computed source color');
    await page.evaluate(() => document.documentElement.classList.remove('dark')); await settle();
    await page.locator('#scroller').evaluate(node => { node.scrollTop = 500; }); await settle();
    check(await page.locator('#scrolled').evaluate(node => node.hasAttribute('data-cc-rendered')), 'Intersection entering nested scroller mounts self-drawn panel');
    const scrolled = await rect('#scrolled'); image = await pixels();
    check(blue(image.at(scrolled.x + 8, scrolled.y + 8)), 'Scrolled curve remains aligned in actual pixels');
    await page.locator('.m3-segment-thumb').evaluate(node => { node.style.transform = 'translateX(120px)'; node.style.width = '120px'; }); await settle();
    check(await page.locator('.m3-segment-thumb').evaluate(node => node.hasAttribute('data-cc-rendered')), 'Dynamic segmented thumb is self-drawn');
    const range = await rect('#range'); image = await pixels();
    const selected = image.at(range.x + 24, range.y + 22), unselected = image.at(range.x + 200, range.y + 22);
    check(selected[0] > 100 && selected[1] < 100 && unselected.slice(0, 3).every(v => v >= 155 && v <= 180), 'Actual native range track shows self-drawn selected/unselected paint');
    await page.locator('#range').evaluate(node => node.style.setProperty('--range-progress', '75%')); await settle(); image = await pixels();
    check(image.at(range.x + 140, range.y + 22)[1] < 100, 'Programmatic range progress redraws');
    await page.locator('#range').focus(); await page.locator('#range').press('ArrowRight');
    check(Number(await page.locator('#range').inputValue()) > 25, 'Range keyboard semantics preserved');
    await page.locator('#dense').evaluate(node => { for (let i = 0; i < 1000; i++) { const card = document.createElement('div'); card.className = 'cc-dense'; for (let j = 0; j < 8; j++) { const text = document.createElement('span'); text.textContent = 'glyph'; card.append(text); } node.append(card); } });
    await settle();
    const dense = await page.evaluate(() => window.cornerTest.stats());
    check(dense.tracked > 1000 && dense.visible < 100 && dense.applied < 100, `Dense cards are intersection bounded (${JSON.stringify(dense)})`);
    check(dense.tracked < 1100 && dense.selectProbes <= 3, 'Eight thousand text spans get no IO/RO; select font probes are cached');
    const frames = dense.frames;
    await page.waitForTimeout(250);
    check(await page.evaluate(frames => window.cornerTest.stats().frames === frames, frames), 'No idle requestAnimationFrame polling');
    await page.locator('#dense').evaluate(node => node.replaceChildren()); await settle();
    check((await page.evaluate(() => window.cornerTest.stats())).tracked < 100, 'Removed dynamic cards release observers/state');
    await page.locator('#select').evaluate(node => { node.multiple = true; node.size = 2; }); await settle();
    check(await page.locator('#select').evaluate(node => !node.hasAttribute('data-cc-select') && getComputedStyle(node).appearance === window.beforeSelects[node.id].appearance), 'Single-to-multiple mutation restores native appearance');
    await page.locator('#select').evaluate(node => { node.multiple = false; node.size = 0; }); await settle();
    check(await page.locator('#select').evaluate(node => node.hasAttribute('data-cc-select')), 'Multiple-to-single mutation remounts the closed shell');
    await page.emulateMedia({ media: 'print' }); await settle();
    check(await page.locator('#select').evaluate(node => { const s = getComputedStyle(node), b = window.beforeSelects[node.id]; return s.appearance === b.appearance && s.backgroundColor === 'rgb(36, 104, 172)' && s.borderImageSource === 'none' && s.paddingRight === b.padding[1]; }), 'Print ignores all select shell attributes and restores authored paint/padding/appearance');
    check(await page.locator('#select-disabled').evaluate(node => getComputedStyle(node).opacity === window.beforeSelects[node.id].opacity), 'Print has no generated opacity leak');
    await page.emulateMedia({ media: 'screen' }); await settle();
    if (shots) await page.screenshot({ path: join(shots, `corners-${engine}.png`) });
    await page.emulateMedia({ forcedColors: 'active' }); await settle();
    if (await page.evaluate(() => matchMedia('(forced-colors: active)').matches)) check(await page.locator('#panel').evaluate(node => !node.hasAttribute('data-cc-rendered')), 'Forced colors restores native accessible paint');
    await page.emulateMedia({ forcedColors: 'none' }); await settle();
    await page.evaluate(() => window.cornerTest.dispose());
    check(await page.evaluate(() => !document.querySelector('[data-cc-rendered], [data-cc-range], [data-cc-measure], [data-cc-select]')), 'Dispose removes all generated paint attributes');
    check(await page.locator('#select').evaluate(node => getComputedStyle(node).appearance === window.beforeSelects[node.id].appearance && !node.style.getPropertyValue('--cc-select-end')), 'Dispose restores select appearance and private padding variables');
    check(await page.locator('#panel').evaluate(node => !node.style.getPropertyValue('--cc-image') && getComputedStyle(node).backgroundColor === 'rgb(36, 104, 172)'), 'Dispose restores authored background');
    check(errors.length === 0, `No page errors: ${errors.join('; ')}`);
    if (process.argv.includes('--app-perf')) {
      const app = await context.newPage();
      app.on('pageerror', error => errors.push(error.message));
      const started = Date.now();
      try {
        await app.goto(new URL('#/all', base).href);
        await app.locator('.allops-card').first().waitFor();
        // The real view deliberately mounts cards in idle chunks. Font readiness
        // and a first visible card do not mean all 969 cards have been mounted.
        await app.waitForFunction(() => document.querySelectorAll('.allops-card').length === 969);
        await app.evaluate(async moduleURL => { await document.fonts.ready; window.cornerPerf = (await import(moduleURL)).setupContinuousCorners(); }, moduleURL);
        await app.waitForFunction(() => {
          const stats = window.cornerPerf.stats(), now = performance.now();
          if (window.cornerQuiet?.frames !== stats.frames) window.cornerQuiet = { frames: stats.frames, since: now };
          return !stats.pending && now - window.cornerQuiet.since >= 350;
        }, undefined, { polling: 50 });
        const initial = await app.evaluate(() => {
          const api = window.cornerPerf, cards = [...document.querySelectorAll('.allops-card')];
          const text = [...document.querySelectorAll('.allops-card-name, .allops-card-id, .allops-card-desc, .allops-card-head, .allops-card-meta, .allops-card-cat, .allops-card-famlbl, .msym, font')];
          return { cards: cards.length, elements: document.querySelectorAll('*').length, text: text.length,
            observedText: text.filter(node => api.inspect(node)).length, observedCards: cards.filter(node => api.inspect(node)).length, stats: api.stats() };
        });
        check(initial.cards === 969, `Actual all-operations card count: ${initial.cards}`);
        if (initial.stats.mode === 'svg') {
          check(initial.observedCards === 969 && initial.observedText === 0, 'Actual 969 cards observed, unpainted labels/glyphs get no IO');
          check(initial.stats.tracked < initial.elements / 2 && initial.stats.tracked < 969 * 4 + 400 && initial.stats.visible < 400, `Actual page IO/RO bounded: ${JSON.stringify(initial)}`);
          await app.waitForTimeout(250);
          check(await app.evaluate(frames => window.cornerPerf.stats().frames === frames, initial.stats.frames), 'Actual all-operations page has no idle renderer polling');
          await app.locator('.allops-card').last().scrollIntoViewIfNeeded();
          await app.waitForTimeout(180);
          await app.waitForFunction(() => { const node = [...document.querySelectorAll('.allops-card')].at(-1); return window.cornerPerf.inspect(node)?.applied && window.cornerPerf.inspect(node)?.visible; });
          const after = await app.evaluate(() => window.cornerPerf.stats());
          check(after.measured - initial.stats.measured < 500, `Actual page scrolling samples visible elements, not all cards (${after.measured - initial.stats.measured})`);
        } else check(initial.stats.frames === 0, 'Native engine has zero observer/renderer frames');
        check(errors.length === 0, `Actual app pageerror: ${errors.join('; ')}`);
        console.log(`App performance: ${engine}; ready=${Date.now() - started}ms; ${JSON.stringify(initial)}`);
      } finally { await app.close(); }
    }
    console.log(`Browser: ${engine}${channel ? `/${channel}` : ''}; ${checks} total PASS; native=${native}; contour=${contour}; pageerror=${errors.length}`);
  } finally { await context.close(); await browser.close(); }
}

// PNG screenshot decoder, deliberately independent of DOM/SVG implementation.
// Playwright emits non-interlaced 8-bit RGB/RGBA PNG. No image dependency needed.
function decodePNG(buffer) {
  check(buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), 'PNG screenshot signature');
  let width, height, channels;
  const chunks = [];
  for (let offset = 8; offset < buffer.length;) {
    const length = buffer.readUInt32BE(offset), type = buffer.toString('ascii', offset + 4, offset + 8), data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      assert(data[8] === 8 && [2, 6].includes(data[9]) && data[12] === 0, 'Expected 8-bit noninterlaced RGB/RGBA screenshot');
      channels = data[9] === 6 ? 4 : 3;
    } else if (type === 'IDAT') chunks.push(data);
    offset += length + 12;
  }
  const raw = inflateSync(Buffer.concat(chunks)), stride = width * channels, pixels = Buffer.alloc(stride * height);
  const paeth = (a, b, c) => { const p = a + b - c, da = Math.abs(p - a), db = Math.abs(p - b), dc = Math.abs(p - c); return da <= db && da <= dc ? a : db <= dc ? b : c; };
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? pixels[y * stride + x - channels] : 0, b = y ? pixels[(y - 1) * stride + x] : 0, c = y && x >= channels ? pixels[(y - 1) * stride + x - channels] : 0;
      const predict = [0, a, b, Math.floor((a + b) / 2), paeth(a, b, c)][filter];
      assert(predict != null, 'PNG row filter');
      pixels[y * stride + x] = (raw[y * (stride + 1) + 1 + x] + predict) & 255;
    }
  }
  return { width, height, at(x, y) { x = Math.floor(x); y = Math.floor(y); assert(x >= 0 && y >= 0 && x < width && y < height, `Pixel (${x},${y}) within screenshot`); return [...pixels.subarray((y * width + x) * channels, (y * width + x) * channels + channels)]; } };
}
