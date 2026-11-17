#!/usr/bin/env node
/*
 * 科普示例复现检查：按示例自带的 run 描述真实执行算法，核对示例写的输出是否就是程序的实际输出。
 *
 * 用法：node tools/edu_examples_check.mjs <分片.js> [<分片.js> ...] [--ops id1,id2] [--require-run] [--out report.json]
 *
 * 分片是科普数据文件（export default { opId: { examples: [...] } }），可以是现用文件，也可以是待审的候选副本。
 * 示例字段：
 *   in / param / out / desc      展示用，页面原样显示；
 *   run（可选，页面不显示）      { dir: "encode|decode|run", params: {键: 值}, inputHex: "..."（字节输入时代替 in）,
 *                                  match: "exact"（默认，out 必须等于完整输出）| "contains"（out 必须是输出的连续片段） }
 * 没有 run 的示例记为 UNCHECKED；加 --require-run 时，--ops 指定的算法里出现 UNCHECKED 即失败。
 * 本工具只读，不修改任何文件。
 */
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const root = pathToFileURL(resolve('.')).href + '/';
const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? (args[i + 1] ?? '') : null; };
const outPath = flag('--out') || '';
const onlyOps = flag('--ops') ? flag('--ops').split(',').map((s) => s.trim()).filter(Boolean) : null;
const requireRun = args.includes('--require-run');
const files = args.filter((a, i) => !a.startsWith('--') && !['--out', '--ops'].includes(args[i - 1]));
if (!files.length) { console.error('usage: node tools/edu_examples_check.mjs <shard.js> [...] [--ops a,b] [--require-run] [--out report.json]'); process.exit(2); }

await import(root + 'src/core/registerAll.js');
const { getOp } = await import(root + 'src/core/registry.js');
const { OP_FILE_MAP } = await import(root + 'src/core/lazyTables.generated.js');
async function loadOp(id) {
  let op = getOp(id);
  if ((!op || op.__stub) && OP_FILE_MAP[id]) { await import(new URL(OP_FILE_MAP[id], root + 'src/core/').href); op = getOp(id); }
  return op && !op.__stub ? op : null;
}
const textOf = (out) => (typeof out === 'string' ? out : out && typeof out === 'object' && typeof out.text === 'string' ? out.text : out == null ? '' : JSON.stringify(out));

const rows = [];
for (const file of files) {
  const mod = await import(pathToFileURL(resolve(file)).href);
  const data = mod.default;
  if (!data || typeof data !== 'object') { rows.push({ file, opId: '', index: -1, status: 'FAIL', reason: '分片没有默认导出对象' }); continue; }
  for (const [opId, entry] of Object.entries(data)) {
    if (onlyOps && !onlyOps.includes(opId)) continue;
    const examples = Array.isArray(entry?.examples) ? entry.examples : [];
    for (let i = 0; i < examples.length; i++) {
      const ex = examples[i] || {};
      const row = { file, opId, index: i, status: 'UNCHECKED', reason: '' };
      rows.push(row);
      if (!ex.run) { row.reason = '示例没有 run 描述'; continue; }
      try {
        const op = await loadOp(opId);
        if (!op) { row.status = 'FAIL'; row.reason = '算法未注册'; continue; }
        const dir = ex.run.dir;
        if (!['run', 'encode', 'decode'].includes(dir) || typeof op[dir] !== 'function') { row.status = 'FAIL'; row.reason = '方向不存在：' + dir; continue; }
        const params = {};
        for (const p of op.params || []) if (p.default !== undefined) params[p.key] = p.default;
        const known = new Set((op.params || []).map((p) => p.key));
        const unknown = Object.keys(ex.run.params || {}).filter((k) => !known.has(k));
        if (unknown.length) { row.status = 'FAIL'; row.reason = '参数不存在：' + unknown.join(','); continue; }
        Object.assign(params, ex.run.params || {});
        let input = typeof ex.in === 'string' ? ex.in : '';
        if (typeof ex.run.inputHex === 'string') {
          params.rawBytes = Uint8Array.from((ex.run.inputHex.match(/../g) || []).map((x) => parseInt(x, 16)));
          input = ex.run.inputHex;
        }
        const actual = textOf(await op[dir].call(op, input, params));
        const want = String(ex.out ?? '');
        const ok = ex.run.match === 'contains' ? (want !== '' && actual.includes(want)) : actual === want;
        row.status = ok ? 'PASS' : 'FAIL';
        if (!ok) { row.reason = '输出与示例不符'; row.expected = want.slice(0, 300); row.actual = actual.slice(0, 300); }
      } catch (e) {
        row.status = 'FAIL'; row.reason = '执行抛错：' + ((e && e.message) || String(e));
      }
    }
  }
}
if (onlyOps) for (const id of onlyOps) if (!rows.some((r) => r.opId === id)) rows.push({ file: '', opId: id, index: -1, status: 'FAIL', reason: '给定分片里没有这个算法的示例' });

const count = (s) => rows.filter((r) => r.status === s).length;
const failed = count('FAIL') + (requireRun ? count('UNCHECKED') : 0);
const report = {
  verdict: failed ? 'FAIL' : 'PASS', files: files.length, examples: rows.length,
  pass: count('PASS'), fail: count('FAIL'), unchecked: count('UNCHECKED'), requireRun,
  problems: rows.filter((r) => r.status === 'FAIL' || (requireRun && r.status === 'UNCHECKED')),
};
if (outPath) writeFileSync(outPath, JSON.stringify({ ...report, rows }, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
if (failed) process.exitCode = 1;
