#!/usr/bin/env node
/*
 * 批任务扩批探针：给定「用例数据」，验证某个算法能否无损走完 CSV → Task → 执行 → Result 全链路。
 *
 * 用法：node tools/batch_rollout_probe.mjs <cases.json> [--out report.json]
 *
 * cases.json：
 *   { "cases": [ {
 *       "id": "唯一名", "opId": "...", "direction": "run|encode|decode",
 *       "inputKind": "text|bytes|none", "input": "...", "encoding": "hex|base64|utf8"（仅 bytes）,
 *       "params": { "键": "CSV 单元格文本" }, "fields": { "键": "文本" },
 *       "expect": { "text": "完整输出" | "textContains": ["片段"] | "error": true,
 *                   "files": [ { "name": "...", "sha256": "..." } ] },
 *       "source": "期望值的公开出处（标准号/章节/向量编号/可复算的推导）"
 *   } ] }
 *
 * 判据（全部满足该算法才算通过）：
 *   1. 每个算法至少 2 条用例，其中至少 1 条成功路径带完整期望（text 或 files）；
 *   2. 用例经真实 CSV 文本解析后执行，结果必须等于 expect——期望来自 source，不从本工具输出回填；
 *   3. 批通道结果与直接调用算法的单次结果逐字节一致（文本与全部产物）；
 *   4. 结果可结构化克隆（能过 Worker 边界），且无 omitted。
 * 本工具不修改任何产品文件；通过名单只写进报告，由维护者决定是否纳入正式范围。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const root = pathToFileURL(resolve('.')).href + '/';
const args = process.argv.slice(2);
const casesPath = args.find((a) => !a.startsWith('--'));
const outIndex = args.indexOf('--out');
const outPath = outIndex >= 0 ? args[outIndex + 1] : '';
if (!casesPath) { console.error('usage: node tools/batch_rollout_probe.mjs <cases.json> [--out report.json]'); process.exit(2); }

await import(root + 'src/core/registerAll.js');
const { getOp } = await import(root + 'src/core/registry.js');
const { OP_FILE_MAP } = await import(root + 'src/core/lazyTables.generated.js');
const { schemaForOp } = await import(root + 'src/ui/batchCsvSection.js');
const { tasksFromCsv } = await import(root + 'src/core/batchCsv.js');
const { executeBatchTask } = await import(root + 'src/core/batchTaskExecution.js');
const { BATCH_TASK_OPS } = await import(root + 'src/core/batchTaskContract.js');

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const cell = (v) => { const s = String(v ?? ''); return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
const own = (o, k) => Object.prototype.hasOwnProperty.call(o || {}, k);
function decode(input, encoding) {
  if (encoding === 'hex') return Uint8Array.from((input.match(/../g) || []).map((x) => parseInt(x, 16)));
  if (encoding === 'base64') return new Uint8Array(Buffer.from(input, 'base64'));
  return new TextEncoder().encode(input);
}
function normSingle(out) {
  if (typeof out === 'string') return { text: out, files: [] };
  if (out instanceof ArrayBuffer || ArrayBuffer.isView(out)) return { text: '', files: [{ name: 'result.bin', bytes: new Uint8Array(out.buffer ?? out, out.byteOffset ?? 0, out.byteLength) }] };
  if (out && typeof out === 'object' && (own(out, 'text') || own(out, 'files'))) {
    return { text: typeof out.text === 'string' ? out.text : '', files: (out.files || []).map((f) => ({ name: f.name, bytes: f.bytes instanceof Uint8Array ? f.bytes : null })) };
  }
  return { text: out == null ? '' : JSON.stringify(out), files: [] };
}
async function loadOp(id) {
  let op = getOp(id);
  if ((!op || op.__stub) && OP_FILE_MAP[id]) { await import(new URL(OP_FILE_MAP[id], root + 'src/core/').href); op = getOp(id); }
  return op && !op.__stub ? op : null;
}

const doc = JSON.parse(readFileSync(casesPath, 'utf8'));
const cases = Array.isArray(doc.cases) ? doc.cases : [];
const results = [];
for (const c of cases) {
  const r = { id: c.id, opId: c.opId, status: 'FAIL', problems: [] };
  results.push(r);
  const bad = (m) => r.problems.push(m);
  try {
    if (!c.id || !c.opId) { bad('缺 id / opId'); continue; }
    if (typeof c.source !== 'string' || c.source.trim().length < 8) bad('缺 source：期望值必须写明公开出处');
    if (!c.expect || !(own(c.expect, 'text') || own(c.expect, 'textContains') || own(c.expect, 'files') || c.expect.error === true)) bad('缺 expect');
    const op = await loadOp(c.opId);
    if (!op) { bad('算法未注册'); continue; }
    const schema = schemaForOp(op);
    const known = new Set(schema.columns.map((x) => x.key));
    const params = c.params || {}, fields = c.fields || {};
    for (const k of Object.keys(params)) if (!known.has('param.' + k)) bad('未知参数列 param.' + k);
    for (const k of Object.keys(fields)) if (!known.has('field.' + k)) bad('未知字段列 field.' + k);
    if (r.problems.length) continue;
    const header = ['taskId', 'opId', 'direction', 'inputKind', 'input', 'encoding', ...Object.keys(params).map((k) => 'param.' + k), ...Object.keys(fields).map((k) => 'field.' + k)];
    const row = [c.id, c.opId, c.direction ?? '', c.inputKind ?? 'text', c.input ?? '', c.encoding ?? '', ...Object.values(params), ...Object.values(fields)];
    const csv = header.join(',') + '\r\n' + row.map(cell).join(',') + '\r\n';
    const parsed = tasksFromCsv(csv, schema, { ops: [c.opId] });
    if (parsed.errors.length || parsed.tasks.length !== 1) {
      r.batch = { status: 'precheck-error', error: parsed.errors.map((e) => e.code + ' ' + e.message).join('; ') };
    } else {
      let result;
      try { result = await executeBatchTask(parsed.tasks[0], { rollout: [c.opId] }); }
      catch (e) { result = { status: 'error', text: '', files: [], omitted: [], error: { code: e.code || 'ERROR', message: e.message } }; }
      try { structuredClone(result); } catch (e) { bad('结果无法结构化克隆：' + e.message); }
      r.batch = { status: result.status, text: result.text, files: (result.files || []).map((f) => ({ name: f.name, size: f.size, sha256: sha256(f.bytes) })), error: result.error ? result.error.code + ' ' + result.error.message : '', omitted: (result.omitted || []).length };
    }
    // 单次直接调用：参数按声明类型独立转换，不复用批通道的转换结果。
    const single = {};
    for (const p of op.params || []) if (p.default !== undefined) single[p.key] = p.default;
    for (const [k, v] of Object.entries(params)) {
      const def = (op.params || []).find((p) => p.key === k) || {};
      single[k] = ['number', 'int', 'float'].includes(def.type) ? Number(v) : ['bool', 'boolean'].includes(def.type) ? /^(true|1)$/i.test(v) : v;
    }
    let singleInput = c.inputKind === 'none' ? '' : (c.input ?? '');
    if (c.inputKind === 'bytes') { single.rawBytes = decode(c.input ?? '', c.encoding); singleInput = Buffer.from(single.rawBytes).toString('hex'); }
    const fieldKeys = (op.fields || []).map((f) => f.key);
    if (Object.keys(fields).length && op.id !== 'diffTool') singleInput = fieldKeys.map((k) => fields[k] ?? '').join(op.fieldsJoin ?? '\n');
    const direction = c.direction || (typeof op.run === 'function' ? 'run' : typeof op.encode === 'function' ? 'encode' : 'decode');
    let s = null, singleError = null;
    try { s = normSingle(await op[direction].call(op, singleInput, single)); } catch (e) { singleError = e; }
    r.single = singleError ? { status: 'error', error: singleError.message } : { status: 'ok', text: s.text, files: s.files.map((f) => ({ name: f.name, sha256: f.bytes ? sha256(f.bytes) : null })) };

    const b = r.batch;
    if (c.expect.error === true) {
      if (b.status === 'ok') bad('期望失败但批通道成功');
      if (!singleError && b.status !== 'precheck-error') bad('期望失败但单次调用成功');
    } else {
      if (b.status !== 'ok') bad('批通道未成功：' + b.status + ' ' + (b.error || ''));
      if (singleError) bad('单次调用失败：' + singleError.message);
      if (b.omitted) bad('结果有 omitted');
      if (b.status === 'ok' && !singleError) {
        if (b.text !== s.text) bad('批通道文本与单次不一致');
        const sf = r.single.files;
        if (b.files.length !== sf.length || b.files.some((f, i) => f.name !== sf[i].name || f.sha256 !== sf[i].sha256)) bad('批通道产物与单次不一致');
      }
      if (own(c.expect, 'text') && b.text !== c.expect.text) bad('文本不等于 expect.text');
      if (own(c.expect, 'textContains')) for (const part of c.expect.textContains) if (!String(b.text || '').includes(part)) bad('文本缺少片段：' + part);
      if (own(c.expect, 'files')) {
        const got = b.files || [];
        if (got.length !== c.expect.files.length) bad('产物数量不等于 expect.files');
        for (const want of c.expect.files) {
          const hit = got.find((f) => f.name === want.name);
          if (!hit) bad('缺产物 ' + want.name);
          else if (want.sha256 && hit.sha256 !== want.sha256.toLowerCase()) bad('产物 ' + want.name + ' 的 sha256 不符');
        }
      }
    }
    if (!r.problems.length) r.status = 'PASS';
  } catch (e) {
    bad('探针异常：' + ((e && e.message) || String(e)));
  }
}

const byOp = new Map();
for (const r of results) { if (!byOp.has(r.opId)) byOp.set(r.opId, []); byOp.get(r.opId).push(r); }
const ops = [];
for (const [opId, list] of byOp) {
  const src = cases.filter((c) => c.opId === opId);
  const strong = src.some((c) => c.expect && c.expect.error !== true && (own(c.expect, 'text') || own(c.expect, 'files')));
  const reasons = [];
  if (list.length < 2) reasons.push('用例少于 2 条');
  if (!strong) reasons.push('缺少带完整期望（text 或 files）的成功用例');
  if (list.some((r) => r.status !== 'PASS')) reasons.push('有用例未通过');
  ops.push({ opId, cases: list.length, verified: reasons.length === 0, reasons, alreadyInRollout: BATCH_TASK_OPS.includes(opId) });
}
const report = {
  verdict: ops.length && ops.every((o) => o.verified) ? 'PASS' : 'FAIL',
  cases: results.length, casesPassed: results.filter((r) => r.status === 'PASS').length,
  ops: ops.length, verifiedOps: ops.filter((o) => o.verified).map((o) => o.opId),
  rejectedOps: ops.filter((o) => !o.verified).map((o) => ({ opId: o.opId, reasons: o.reasons })),
  failures: results.filter((r) => r.status !== 'PASS').map((r) => ({ id: r.id, opId: r.opId, problems: r.problems })),
};
if (outPath) writeFileSync(outPath, JSON.stringify({ ...report, results }, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
if (report.verdict !== 'PASS') process.exitCode = 1;
