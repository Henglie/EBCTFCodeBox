/*
 * CSV 批量任务真实浏览器验证：算法页 → 批处理弹窗 → CSV 区块的完整路径。
 *
 * 覆盖：模板原样可预检可执行；rollout 内全部 8 个 op 走真实 CSV 入口并对照公开向量 /
 *       可独立推导的结果；字节与文件通道（单独选文件、选目录）；产物 ZIP 逐条目核对；
 *       运行中取消、单行超时后续行继续、运行中关窗被拒、重开不残留、主工作台不受影响；
 *       旧「多文件同一算法」模式不受 CSV 区块影响；错误 CSV 的可见报错。
 * 期望值硬编码在本文件（RFC 4648 / RFC 1321 / NIST SP 800-38A / NIST GCM / 孙子算经），
 * 不从任何结果文件回填。范围只代表这 8 个 op。
 *
 * 需要 PLAYWRIGHT_MODULE 指向 playwright 或 playwright-core；Chrome 走系统安装，或用 CHROME_PATH 指定。
 * 可选 EBCTF_SHOTS 指定截图目录。
 */
import http from 'node:http';
import { readFile, mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, resolve, normalize } from 'node:path';
import { createRequire } from 'node:module';
import { inflateRawSync } from 'node:zlib';

const require = createRequire(import.meta.url);
const pw = require(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const root = resolve('.');
const shots = process.env.EBCTF_SHOTS || '';
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.webp': 'image/webp', '.woff2': 'font/woff2', '.bin': 'application/octet-stream',
  '.wasm': 'application/wasm', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1');
    let p = normalize(join(root, decodeURIComponent(url.pathname)));
    if (!p.startsWith(root)) { res.writeHead(403).end(); return; }
    if (!existsSync(p) || p.endsWith('\\') || p.endsWith('/')) p = join(p, 'index.html');
    const body = await readFile(p);
    res.writeHead(200, { 'content-type': MIME[extname(p)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
  }
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const base = 'http://127.0.0.1:' + server.address().port + '/';

const checks = [];
const ok = (name, cond, detail) => checks.push({ name, status: cond ? 'PASS' : 'FAIL', ...(detail !== undefined && !cond ? { detail: String(detail).slice(0, 400) } : {}) });
const errors = [];
const timings = {};

// ---- 独立工具：CSV 写出 / 结果 CSV 解析 / ZIP 读取 / GIF 结构 ----
const cell = (v) => { const s = String(v ?? ''); return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
const toCsv = (header, rows) => [header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
function parseCsv(text) {
  const s = text.replace(/^\uFEFF/, '');
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) { if (ch === '"') { if (s[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; continue; }
    if (ch === '"') q = true;
    else if (ch === ',') { row.push(cur); cur = ''; }
    else if (ch === '\r' || ch === '\n') { if (ch === '\r' && s[i + 1] === '\n') i++; row.push(cur); cur = ''; rows.push(row); row = []; }
    else cur += ch;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  const header = rows.shift() || [];
  return rows.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])));
}
function readZip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('ZIP 无 EOCD');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = new Map();
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('ZIP 中央目录损坏');
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), usize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32), local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    const dataStart = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(dataStart, dataStart + csize);
    const data = method === 0 ? Buffer.from(raw) : method === 8 ? inflateRawSync(raw) : null;
    if (!data || data.length !== usize) throw new Error('ZIP 条目无法解出：' + name);
    out.set(name, data);
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}
/** 独立解析 GIF 结构：逻辑屏宽高与图像描述符个数（帧数），不依赖被测实现。 */
function gifInfo(buf) {
  const width = buf.readUInt16LE(6), height = buf.readUInt16LE(8);
  let p = 13;
  if (buf[10] & 0x80) p += 3 * (1 << ((buf[10] & 7) + 1));
  let frames = 0;
  while (p < buf.length) {
    const b = buf[p];
    if (b === 0x3b) break;
    if (b === 0x21) { p += 2; while (buf[p]) p += buf[p] + 1; p++; continue; }
    if (b === 0x2c) {
      frames++;
      const packed = buf[p + 9];
      p += 10;
      if (packed & 0x80) p += 3 * (1 << ((packed & 7) + 1));
      p++;
      while (buf[p]) p += buf[p] + 1;
      p++;
      continue;
    }
    throw new Error('GIF 结构无法解析');
  }
  return { width, height, frames };
}
const pngSize = (buf) => (buf.subarray(0, 8).toString('hex') === '89504e470d0a1a0a' ? { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) } : null);
const bigDigits = (digits, seed) => { let s = String(seed); while (s.length < digits) s += String((s.length * 7 + seed) % 10); return s.slice(0, digits).replace(/^0/, '1'); };

// 最小合法 GIF89a：1×1、单帧。
const gifBuf = Buffer.from('47494638396101000100800000000000ffffff21f90401000000002c00000000010001000002024401003b', 'hex');
const gif = gifInfo(gifBuf);
const work = await mkdtemp(join(tmpdir(), 'ebctf-csv-ui-'));
await mkdir(join(work, 'picked', 'sub'), { recursive: true });
await writeFile(join(work, 'picked', 'sub', 'tiny.gif'), gifBuf);
await writeFile(join(work, 'tiny.gif'), gifBuf);
await writeFile(join(work, 'a.txt'), 'hello');
await writeFile(join(work, 'b.txt'), 'world');

const browser = await pw.chromium.launch({
  headless: true,
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }),
  args: ['--no-sandbox'],
});
// SW 一律拦截：否则旧缓存供页会让「改动不生效」的假象出现。
const context = await browser.newContext({ viewport: { width: 1366, height: 900 }, serviceWorkers: 'block', acceptDownloads: true });
await context.addInitScript(() => localStorage.setItem('ebctf_locale', 'zh'));
const page = await context.newPage();
page.on('pageerror', (e) => errors.push(e.message));

const statusText = async () => (await page.locator('.bp-csv-status').first().textContent()) || '';
const btn = (text) => page.locator('.bp-csv button', { hasText: text });
const shot = async (name) => { if (shots) await page.screenshot({ path: join(shots, name + '.png'), fullPage: false }); };
async function openOp(id) {
  await page.goto(base + '#/op/' + id, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.batch-open:not([disabled])', { state: 'visible', timeout: 45000 });
  await page.locator('.batch-open:not([disabled]):visible').first().click();
  await page.waitForSelector('.batch-panel .bp-csv', { timeout: 20000 });
}
async function closeDialog() {
  await page.locator('.batch-dialog .exp-close').click();
  await page.waitForSelector('.batch-overlay', { state: 'detached', timeout: 8000 });
}
async function download(text) {
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), btn(text).click()]);
  return { name: dl.suggestedFilename(), bytes: await readFile(await dl.path()) };
}
async function loadCsv(csv, name = 'batch.csv') {
  await page.setInputFiles('.bp-csv .bp-csv-input', { name, mimeType: 'text/csv', buffer: Buffer.isBuffer(csv) ? csv : Buffer.from(csv, 'utf8') });
  await page.waitForFunction((n) => (document.querySelector('.bp-csv-status')?.textContent || '').includes(n), name, { timeout: 15000 });
  return statusText();
}
async function runAndWait(timeout = 90000) {
  await btn('执行 CSV').click();
  await page.waitForFunction(() => /^(完成|执行失败)/.test(document.querySelector('.bp-csv-status')?.textContent || ''), null, { timeout });
  return statusText();
}
const resultRows = async () => parseCsv((await download('导出结果 CSV')).bytes.toString('utf8'));

const AES_KEY = '2b7e151628aed2a6abf7158809cf4f3c';
const BASE = ['taskId', 'opId', 'direction', 'inputKind', 'input', 'encoding'];

try {
  // ---------- A. base64：模板原样可用 + 文本两行 + 字节通道 + 错行继续 ----------
  await openOp('base64');
  ok('CSV 区块存在且标题正确', (await page.locator('.bp-csv-title').first().textContent() || '').includes('CSV 批量任务'));
  ok('字节类算法显示文件选择按钮', await btn('选择文件').count() === 1 && await btn('选择目录').count() === 1);
  ok('未载入时执行与导出均禁用', await btn('执行 CSV').isDisabled() && await btn('导出结果 CSV').isDisabled() && await btn('导出产物 ZIP').isDisabled());
  const tpl = await download('下载模板');
  const tplText = tpl.bytes.toString('utf8');
  ok('模板文件名含 opId', tpl.name === 'base64-batch-template.csv', tpl.name);
  ok('模板只有表头与样例两行、无注释', tplText.split('\r\n').filter(Boolean).length === 2 && !/^#/m.test(tplText), tplText.slice(0, 200));
  let s = await loadCsv(tpl.bytes, 'template.csv');
  ok('模板原样载入：1 行可执行、0 错误', /1 行，可执行 1 条，错误 0 条/.test(s), s);
  s = await runAndWait();
  ok('模板原样执行成功', /^完成：成功 1，失败 0/.test(s), s);

  s = await loadCsv(toCsv([...BASE, 'param.strictMode'], [
    ['t1', 'base64', 'encode', 'text', 'hello', '', 'false'],
    ['t2', 'base64', 'decode', 'text', 'aGVsbG8=', '', 'false'],
    ['t3', 'base64', 'decode', 'text', 'aGVsbG8*', '', 'true'],
    ['t4', 'base64', 'encode', 'bytes', '666f6f626172', 'hex', 'false'],
    ['t5', 'base64', 'encode', 'text', 'foobar, "q"\nline2', '', 'false'],
  ]));
  ok('base64 五行全部通过预检', /5 行，可执行 5 条，错误 0 条/.test(s), s);
  await shot('csv-precheck');
  s = await runAndWait();
  ok('base64：4 成功 1 失败，错行不拖死整批', /^完成：成功 4，失败 1，超时 0，取消 0，未执行 0/.test(s), s);
  ok('失败行在界面逐条列出', /t3\s+error/.test(await page.locator('.bp-csv-rows').textContent() || ''));
  let rows = await resultRows();
  const byId = (id) => rows.find((r) => r.taskId === id) || {};
  ok('RFC 4648：hello → aGVsbG8=', byId('t1').text === 'aGVsbG8=' && byId('t1').status === 'ok', JSON.stringify(byId('t1')));
  ok('RFC 4648：aGVsbG8= → hello', byId('t2').text === 'hello', JSON.stringify(byId('t2')));
  ok('严格模式非法字符按行报错', byId('t3').status === 'error' && byId('t3').errorMessage !== '', JSON.stringify(byId('t3')));
  ok('RFC 4648 §10 字节通道：foobar → Zm9vYmFy', byId('t4').text === 'Zm9vYmFy', JSON.stringify(byId('t4')));
  ok('含逗号/引号/换行的输入保真', byId('t5').text === Buffer.from('foobar, "q"\nline2').toString('base64'), JSON.stringify(byId('t5')));
  const json = JSON.parse((await download('导出结果 JSON')).bytes.toString('utf8'));
  ok('结果 JSON 汇总与逐行一致', json.total === 5 && json.ok === 4 && json.failed === 1 && json.results.length === 5, JSON.stringify({ total: json.total, ok: json.ok, failed: json.failed }));
  await shot('csv-done');

  // 错误 CSV 的可见报错
  s = await loadCsv(toCsv(['taskId', 'taskId', 'opId'], [['a', 'b', 'base64']]), 'dup.csv');
  ok('重复表头显式报错且不可执行', /可执行 0 条，错误 1 条/.test(s) && /CSV_DUPLICATE_HEADER/.test(await page.locator('.bp-csv-errors').first().textContent() || '') && await btn('执行 CSV').isDisabled(), s);
  await page.setInputFiles('.bp-csv .bp-csv-input', { name: 'gbk.csv', mimeType: 'text/csv', buffer: Buffer.from([0x74, 0x61, 0x73, 0x6b, 0xd6, 0xd0, 0xce, 0xc4]) });
  await page.waitForFunction(() => /不是合法 UTF-8/.test(document.querySelector('.bp-csv-status')?.textContent || ''), null, { timeout: 10000 });
  ok('非 UTF-8 文件显式拒绝', true);
  s = await loadCsv(toCsv(BASE, [['x1', 'md5', 'run', 'text', 'abc', '']]), 'wrong-op.csv');
  ok('其他算法的行在预检被拒', /可执行 0 条，错误 1 条/.test(s) && /CSV_ENUM/.test(await page.locator('.bp-csv-errors').first().textContent() || ''), s);

  // 旧「多文件同一算法」模式仍可用
  await page.setInputFiles('.batch-panel > input[type=file]:not([webkitdirectory])', [join(work, 'a.txt'), join(work, 'b.txt')]);
  await page.waitForFunction(() => document.querySelectorAll('.batch-panel .bp-table tbody tr').length >= 2, null, { timeout: 15000 });
  await page.locator('.batch-panel > .bp-row button.bp-primary').first().click();
  await page.waitForFunction(() => /成功 2/.test(document.querySelector('.batch-panel')?.textContent || ''), null, { timeout: 60000 });
  ok('旧多文件模式仍按原路径执行 2 个文件', true);
  await closeDialog();

  // ---------- B. md5 / aes / rsaModpow / rsaCrt / babaiCvp / diffTool ----------
  await openOp('md5');
  await loadCsv(toCsv(BASE, [['m1', 'md5', 'run', 'text', 'abc', ''], ['m2', 'md5', 'run', 'text', '', ''], ['m3', 'md5', 'run', 'bytes', '616263', 'hex']]));
  s = await runAndWait(); rows = await resultRows();
  ok('md5 三行成功', /^完成：成功 3，失败 0/.test(s), s);
  ok('RFC 1321 A.5：abc', rows[0].text === '900150983cd24fb0d6963f7d28e17f72', rows[0].text);
  ok('RFC 1321 A.5：空串（显式空单元格保留为空输入）', rows[1].text === 'd41d8cd98f00b204e9800998ecf8427e', rows[1].text);
  ok('md5 字节通道与文本通道一致', rows[2].text === '900150983cd24fb0d6963f7d28e17f72', rows[2].text);
  await closeDialog();

  await openOp('aes');
  const aesHeader = [...BASE, 'param.key', 'param.keyEnc', 'param.mode', 'param.iv', 'param.ivEnc', 'param.padding', 'param.includeIv', 'param.tagLen', 'param.outEnc'];
  await loadCsv(toCsv(aesHeader, [
    ['cbc-enc', 'aes', 'encode', 'bytes', '6bc1bee22e409f96e93d7e117393172a', 'hex', AES_KEY, 'hex', 'CBC', '000102030405060708090a0b0c0d0e0f', 'hex', 'none', 'off', '128', 'hex'],
    ['cbc-dec', 'aes', 'decode', 'text', '7649abac8119b246cee98e9b12e9197d', '', AES_KEY, 'hex', 'CBC', '000102030405060708090a0b0c0d0e0f', 'hex', 'none', 'off', '128', 'hex'],
    ['gcm-enc', 'aes', 'encode', 'bytes', '00000000000000000000000000000000', 'hex', '00000000000000000000000000000000', 'hex', 'GCM', '000000000000000000000000', 'hex', 'pkcs7', 'prepend', '128', 'hex'],
    ['bad-key', 'aes', 'encode', 'text', 'x', '', 'abc', 'hex', 'CBC', '000102030405060708090a0b0c0d0e0f', 'hex', 'pkcs7', 'off', '128', 'hex'],
  ]));
  s = await runAndWait(); rows = await resultRows();
  ok('aes：3 成功 1 失败', /^完成：成功 3，失败 1/.test(s), s);
  ok('NIST SP 800-38A F.2.1 CBC-AES128 加密', rows[0].text === '7649abac8119b246cee98e9b12e9197d', rows[0].text);
  ok('NIST SP 800-38A F.2.2 CBC-AES128 解密', /6bc1bee22e409f96e93d7e117393172a/i.test(Buffer.from(rows[1].text, 'latin1').toString('hex')) || /6bc1bee22e409f96e93d7e117393172a/i.test(rows[1].text), JSON.stringify(rows[1]).slice(0, 300));
  ok('NIST GCM Test Case 2', rows[2].text === '000000000000000000000000' + '0388dace60b6a392f328c2b971b2fe78' + 'ab6e47d42cec13bdf53a67b21257bddf', rows[2].text);
  ok('非法密钥按行失败', rows[3].status === 'error', JSON.stringify(rows[3]).slice(0, 200));
  await closeDialog();

  await openOp('rsaModpow');
  ok('无字节适配的算法不显示文件选择', await btn('选择文件').count() === 0);
  const powHeader = [...BASE, 'param.base', 'param.exp', 'param.mod'];
  s = await loadCsv(toCsv(powHeader, [['b1', 'rsaModpow', 'run', 'bytes', '00', 'hex', '4', '13', '497']]), 'bytes.csv');
  ok('无字节适配的算法在预检拒绝 bytes 行', /可执行 0 条，错误 1 条/.test(s), s);
  await loadCsv(toCsv(powHeader, [['p1', 'rsaModpow', 'run', 'text', '', '', '4', '13', '497'], ['p2', 'rsaModpow', 'run', 'text', '', '', '0012', '2', '1000']]));
  s = await runAndWait(); rows = await resultRows();
  ok('rsaModpow 两行成功', /^完成：成功 2，失败 0/.test(s), s);
  ok('4^13 mod 497 = 445', /= 445\s*$/.test(rows[0].text), rows[0].text.slice(-60));
  ok('12^2 mod 1000 = 144（前导零文本原样下发）', /= 144\s*$/.test(rows[1].text), rows[1].text.slice(-60));

  // ---------- C. 运行中取消 / 关窗被拒 / 单行超时 / 重开无残留（真实 CPU 任务） ----------
  const slow = () => [bigDigits(12000, 3), bigDigits(12000, 7), bigDigits(12000, 9).replace(/.$/, '7')];
  await loadCsv(toCsv(powHeader, [
    ['s1', 'rsaModpow', 'run', 'text', '', '', ...slow()], ['s2', 'rsaModpow', 'run', 'text', '', '', ...slow()],
    ['s3', 'rsaModpow', 'run', 'text', '', '', ...slow()], ['s4', 'rsaModpow', 'run', 'text', '', '', '4', '13', '497'],
  ]), 'slow.csv');
  await btn('执行 CSV').click();
  await page.waitForFunction(() => /执行中/.test(document.querySelector('.bp-csv-status')?.textContent || ''), null, { timeout: 5000 });
  await page.waitForTimeout(700);
  ok('运行中只有取消可点', await btn('取消').isEnabled() && await btn('执行 CSV').isDisabled() && await btn('选择 CSV').isDisabled());
  await page.locator('.batch-dialog .exp-close').click();
  await page.waitForTimeout(400);
  ok('运行中关窗被拒，弹窗仍在', await page.locator('.batch-overlay').count() === 1);
  const cancelAt = Date.now();
  await btn('取消').click();
  await page.waitForFunction(() => /^完成/.test(document.querySelector('.bp-csv-status')?.textContent || ''), null, { timeout: 5000 });
  timings.cancelMs = Date.now() - cancelAt;
  s = await statusText();
  ok('取消在 2 秒内终止在途 CPU 计算', timings.cancelMs < 2000, timings.cancelMs + 'ms');
  ok('取消后无成功行：在途计为取消、未派发计为未执行', /^完成：成功 0，失败 0，超时 0，取消 2，未执行 2/.test(s), s);
  const cancelJson = JSON.parse((await download('导出结果 JSON')).bytes.toString('utf8'));
  ok('取消结果逐行有状态且无迟到成功', cancelJson.cancelled === true && cancelJson.ok === 0 && cancelJson.results.map((r) => r.status).join(',') === 'cancelled,cancelled,skipped,skipped', JSON.stringify(cancelJson.results.map((r) => r.status)));
  await page.waitForTimeout(1500);
  ok('取消后界面不被迟到结果改写', (await statusText()) === s);

  await loadCsv(toCsv(powHeader, [
    ['o1', 'rsaModpow', 'run', 'text', '', '', ...slow()], ['o2', 'rsaModpow', 'run', 'text', '', '', ...slow()],
    ['o3', 'rsaModpow', 'run', 'text', '', '', '4', '13', '497'], ['o4', 'rsaModpow', 'run', 'text', '', '', '5', '3', '13'],
  ]), 'timeout.csv');
  await page.locator('.bp-csv-timeout').fill('0');
  await btn('执行 CSV').click();
  ok('非法超时值被拒绝且不启动', /1–3600/.test(await statusText()));
  await page.locator('.bp-csv-timeout').fill('1');
  const t0 = Date.now();
  s = await runAndWait(30000);
  timings.timeoutBatchMs = Date.now() - t0;
  rows = await resultRows();
  ok('超时两行、其后两行在新 Worker 上成功', /^完成：成功 2，失败 0，超时 2，取消 0，未执行 0/.test(s), s);
  ok('超时行状态为 timeout，后续行结果正确', rows[0].status === 'timeout' && rows[1].status === 'timeout' && /= 445\s*$/.test(rows[2].text) && /= 8\s*$/.test(rows[3].text), JSON.stringify(rows.map((r) => r.status)));
  ok('1 秒超时真实终止 15 秒级计算', timings.timeoutBatchMs < 8000, timings.timeoutBatchMs + 'ms');
  await shot('csv-timeout');
  await closeDialog();
  await openOp('rsaModpow');
  ok('重开弹窗无上一批残留', (await statusText()) === '还没有载入 CSV' && await btn('导出结果 CSV').isDisabled());
  await closeDialog();

  await openOp('rsaCrt');
  await loadCsv(toCsv([...BASE, 'field.residues', 'field.moduli'], [['c1', 'rsaCrt', 'run', 'text', '', '', '2,3,2', '3,5,7'], ['c2', 'rsaCrt', 'run', 'text', '', '', '1,2', '']]));
  s = await runAndWait(); rows = await resultRows();
  ok('rsaCrt 多字段：孙子算经 x = 23', rows[0].status === 'ok' && /x = 23\b/.test(rows[0].text), rows[0].text.slice(0, 200));
  ok('rsaCrt 缺模数的行按行失败', rows[1].status === 'error', JSON.stringify(rows[1]).slice(0, 200));
  await closeDialog();

  await openOp('babaiCvp');
  await loadCsv(toCsv([...BASE, 'field.basis', 'field.target'], [['l1', 'babaiCvp', 'run', 'text', '', '', '3 0\n0 5', '7 11']]));
  s = await runAndWait(); rows = await resultRows();
  ok('babaiCvp 含换行的矩阵字段：正交基最近格点 [6, 10]', rows[0].status === 'ok' && /\[6, 10\]/.test(rows[0].text), rows[0].text.slice(0, 200));
  await closeDialog();

  await openOp('diffTool');
  await loadCsv(toCsv([...BASE, 'param.textB', 'param.mode', 'param.inputEnc', 'param.context'], [
    ['d1', 'diffTool', 'run', 'text', 'abc', '', 'abd', 'byte', 'utf8', '0'],
    ['d2', 'diffTool', 'run', 'text', 'line1\nline2', '', 'line1\nlineX', 'line', 'utf8', '0'],
    ['d3', 'diffTool', 'run', 'text', 'same', '', 'same', 'byte', 'utf8', 'x'],
  ]));
  s = await statusText();
  ok('数字列非法值在预检按行拒绝，其余行仍可执行', /3 行，可执行 2 条，错误 1 条/.test(s), s);
  s = await runAndWait(); rows = await resultRows();
  ok('diffTool 字节模式定位到偏移 0x2 的 63→64', rows[0].status === 'ok' && /0x2/.test(rows[0].text) && /63/.test(rows[0].text) && /64/.test(rows[0].text), rows[0].text.slice(0, 300));
  ok('diffTool 行模式定位到第 2 行', rows[1].status === 'ok' && /L2: line2/.test(rows[1].text) && /L2: lineX/.test(rows[1].text), rows[1].text.slice(0, 300));
  await closeDialog();

  // ---------- D. gifFrames：文件通道（单独选文件 + 选目录）与产物 ZIP ----------
  await openOp('gifFrames');
  const gifHeader = [...BASE, 'param.maxFrames'];
  s = await loadCsv(toCsv(gifHeader, [['g1', 'gifFrames', 'run', 'file', 'tiny.gif', '', '0'], ['g2', 'gifFrames', 'run', 'file', 'sub/tiny.gif', '', '0'], ['g3', 'gifFrames', 'run', 'file', '../tiny.gif', '', '0']]));
  ok('未选文件时 file 行全部在预检报错', /可执行 0 条，错误 3 条/.test(s) && /CSV_FILE_MISSING/.test(await page.locator('.bp-csv-errors').first().textContent() || ''), s);
  await page.setInputFiles('.bp-csv .bp-csv-files-input', [join(work, 'tiny.gif')]);
  await page.waitForFunction(() => /已选文件 1 个/.test(document.querySelector('.bp-csv-files')?.textContent || ''), null, { timeout: 10000 });
  ok('选入单个文件后对应行转为可执行', /可执行 1 条，错误 2 条/.test(await statusText()), await statusText());
  await page.setInputFiles('.bp-csv .bp-csv-dir-input', join(work, 'picked'));
  await page.waitForFunction(() => /已选文件 2 个/.test(document.querySelector('.bp-csv-files')?.textContent || ''), null, { timeout: 10000 });
  s = await statusText();
  ok('选入目录后按目录内相对路径绑定；越界路径仍被拒', /可执行 2 条，错误 1 条/.test(s), s);
  ok('已选文件清单列出两个相对路径', /tiny\.gif/.test(await page.locator('.bp-csv-files').textContent() || '') && /sub\/tiny\.gif/.test(await page.locator('.bp-csv-files').textContent() || ''));
  await shot('csv-files');
  s = await runAndWait(); rows = await resultRows();
  ok('gifFrames 两行成功', /^完成：成功 2，失败 0/.test(s), s);
  ok('结果 CSV 记录每行全部产物数', rows.every((r) => Number(r.fileCount) === gif.frames + 1), JSON.stringify(rows.map((r) => r.fileCount)));
  const zip = readZip((await download('导出产物 ZIP')).bytes);
  const names = [...zip.keys()].sort();
  ok('产物 ZIP 按任务分目录收齐全部文件', names.length === 2 * (gif.frames + 1) && names.filter((n) => n.startsWith('g1/')).length === gif.frames + 1 && names.filter((n) => n.startsWith('g2/')).length === gif.frames + 1, names.join(' '));
  const frames = names.filter((n) => /^g1\/frame_\d+\.png$/.test(n));
  ok('帧数等于 GIF 图像描述符个数', frames.length === gif.frames, frames.length + ' vs ' + gif.frames);
  ok('每帧是合法 PNG 且尺寸等于 GIF 逻辑屏', frames.every((n) => { const d = pngSize(zip.get(n)); return d && d.width === gif.width && d.height === gif.height; }), JSON.stringify(frames.map((n) => pngSize(zip.get(n)))));
  const inner = readZip(zip.get('g1/gif_frames.zip'));
  ok('内层帧包与散帧逐字节一致', frames.every((n) => { const k = n.slice(3); return inner.has(k) && inner.get(k).equals(zip.get(n)); }), [...inner.keys()].join(' '));
  ok('两种文件绑定方式的产物逐字节一致', names.filter((n) => n.startsWith('g1/')).every((n) => zip.get(n).equals(zip.get('g2/' + n.slice(3)))));
  await btn('清空文件').click();
  ok('清空文件后 file 行回到预检报错', /可执行 0 条，错误 3 条/.test(await statusText()), await statusText());
  await closeDialog();

  // ---------- E. 主工作台不受批任务影响 ----------
  await page.goto(base + '#/op/base64', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#ioIn', { timeout: 30000 });
  await page.locator('#ioIn').fill('aGVsbG8=');
  await page.locator('.io-actions .act-btn.primary').first().click();
  await page.waitForFunction(() => { const n = document.querySelector('#ioOut'); return n && ((n.value ?? n.textContent) || '').trim() === 'hello'; }, null, { timeout: 20000 });
  ok('批任务取消/超时后主工作台仍正常计算', true);

  ok('无 pageerror', errors.length === 0, errors.join(' | '));
} catch (e) {
  ok('流程未抛异常', false, (e && e.stack) || String(e));
  try { if (shots) await page.screenshot({ path: join(shots, 'csv-failure.png') }); } catch { /* 页面已关闭 */ }
} finally {
  await context.close();
  await browser.close();
  server.close();
}

const failed = checks.filter((c) => c.status !== 'PASS');
console.log(JSON.stringify({ verdict: failed.length ? 'FAIL' : 'PASS', checks: checks.length, failed: failed.length, failures: failed, gif, timings, pageErrors: errors, names: checks.map((c) => c.status + ' ' + c.name) }, null, 2));
if (failed.length) process.exitCode = 1;
