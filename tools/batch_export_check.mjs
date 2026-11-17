#!/usr/bin/env node
/*
 * 批任务导出自检（M 侧）：CSV/JSON/产物清单/大数组安全。
 * 覆盖三类已知缺陷：Buffer 依赖、spread 展开大数组、只看存在性的假校验。
 */
import { resultsToCsv, resultsToJson, collectArtifacts, artifactsToZipEntries, resultToRecord, RESULT_CSV_COLUMNS } from '../src/core/batchTaskExport.js';

const checks = [];
const ok = (name, cond, detail) => checks.push({ name, status: cond ? 'PASS' : 'FAIL', ...(detail ? { detail } : {}) });
const bytes = (s) => new TextEncoder().encode(s);

const mk = (over = {}) => ({
  schemaVersion: 1, taskId: 't1', attempt: 1, opId: 'base64', status: 'ok',
  text: 'aGVsbG8=', files: [], error: null, omitted: [], budget: { usedBytes: 8, usedFiles: 0 }, ...over,
});

// --- CSV ---
const csv = resultsToCsv([mk()]);
const lines = csv.trim().split('\r\n');
ok('CSV 表头为合同列序', lines[0] === RESULT_CSV_COLUMNS.join(','));
ok('CSV 每行一条结果', lines.length === 2);
ok('CSV 记录字段完整', Object.keys(resultToRecord(mk())).length === RESULT_CSV_COLUMNS.length);
ok('CSV 转义逗号/引号/换行', (() => {
  const out = resultsToCsv([mk({ text: 'a,b"c\nd' })]);
  return out.includes('"a,b""c\nd"');
})());
ok('CSV 保留公式前导字符', resultsToCsv([mk({ text: '=1+1' })]).includes('=1+1'));
ok('显式开启后才转义公式', resultsToCsv([mk({ text: '=1+1' })], { escapeFormula: true }).includes("'=1+1"));
ok('BOM 可选', resultsToCsv([mk()], { bom: true }).charCodeAt(0) === 0xfeff);
ok('CSV 错误字段进列', (() => {
  const out = resultsToCsv([mk({ status: 'error', text: '', error: { code: 'X', message: 'boom' } })]);
  return out.includes('X') && out.includes('boom');
})());

// --- JSON ---
const json = resultsToJson({ jobId: 'batch-1', cancelled: false, results: [mk(), mk({ taskId: 't2', status: 'error', text: '', error: { code: 'E', message: 'bad' } })] });
ok('JSON 汇总 ok/failed', json.total === 2 && json.ok === 1 && json.failed === 1);
ok('JSON 保留 jobId 与 schemaVersion', json.jobId === 'batch-1' && json.schemaVersion === 1);
ok('JSON 不内联产物字节', (() => {
  const withFile = resultsToJson({ results: [mk({ files: [{ name: 'a.bin', mime: 'x/y', bytes: bytes('123'), size: 3 }] })] });
  const meta = withFile.results[0].files[0];
  return meta.name === 'a.bin' && meta.size === 3 && !('bytes' in meta);
})());

// --- 产物清单 ---
const files = [
  mk({ taskId: 'a', files: [{ name: 'x.png', mime: 'image/png', bytes: bytes('1'), size: 1 }, { name: 'x.png', mime: 'image/png', bytes: bytes('2'), size: 1 }] }),
  mk({ taskId: 'b', files: [{ name: 'x.png', mime: 'image/png', bytes: bytes('3'), size: 1 }] }),
];
const arts = collectArtifacts(files);
ok('全部产物都收集', arts.length === 3);
ok('按 taskId 分目录', arts[0].path === 'a/x.png' && arts[2].path === 'b/x.png');
ok('同名产物加序号不覆盖', arts[1].path === 'a/x-2.png', arts[1].path);
ok('保留原始文件名与 mime', arts[0].name === 'x.png' && arts[0].mime === 'image/png');
ok('无产物结果跳过', collectArtifacts([mk()]).length === 0);
ok('非 Uint8Array 字节被跳过而非冒充', collectArtifacts([mk({ files: [{ name: 'bad.bin', mime: 'x', bytes: [1, 2, 3], size: 3 }] })]).length === 0);
ok('可关闭按任务分目录', collectArtifacts(files, { dirPerTask: false })[0].path === 'x.png');

// --- 大数组：不得用 spread 展开 ---
const many = { results: [mk({ taskId: 'big', files: Array.from({ length: 6000 }, (_, i) => ({ name: 'f' + i + '.bin', mime: 'application/octet-stream', bytes: bytes('x'), size: 1 })) })] };
let bigOk = false, bigCount = 0;
try { const big = collectArtifacts(many.results); bigCount = big.length; bigOk = big.length === 6000; } catch (e) { bigOk = false; }
ok('6000 个产物不触发调用栈上限', bigOk, 'count=' + bigCount);
ok('ZIP 条目与产物一一对应', artifactsToZipEntries(arts).length === 3 && artifactsToZipEntries(arts)[1].name === 'a/x-2.png');

const failed = checks.filter((c) => c.status !== 'PASS');
console.log(JSON.stringify({ verdict: failed.length ? 'FAIL' : 'PASS', checks: checks.length, failed: failed.length, failures: failed }, null, 2));
if (failed.length) process.exitCode = 1;
