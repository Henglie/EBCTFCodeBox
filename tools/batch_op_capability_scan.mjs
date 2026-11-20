#!/usr/bin/env node
/*
 * 批量适配性全表扫描（MT800 · 按「能支持就支持」口径）。
 *
 * 不采信外部报告的结论：直接 import 现用 registry，逐个 op 读真实声明字段
 * （方向函数/acceptsBytes/params/fields/requiresBridge/__stub），按统一判据分类。
 * 输出：可批量（文本）/ 可批量（需字节或文件）/ 可批量（需多字段）/ 不可批量（原因）四类，
 * 并给出每类的 opId 清单，供后续逐类实测接入。
 *
 * 注意：本脚本只做「声明层识别」，不等于该 op 已实测可批量；实测批次另有脚本。
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { OPS } from '../src/core/registry.js';
import '../src/core/registerAll.js';

const rows = [];
const buckets = { text: [], bytes: [], fields: [], blocked: [] };

for (const op of OPS) {
  const dirs = ['run', 'encode', 'decode'].filter((d) => typeof op[d] === 'function');
  const params = Array.isArray(op.params) ? op.params : [];
  const fields = Array.isArray(op.fields) ? op.fields : [];
  const reasons = [];
  if (!dirs.length) reasons.push('无 run/encode/decode');
  if (op.__stub) reasons.push('stub（懒表未展开）');
  if (op.requiresBridge) reasons.push('requiresBridge');
  if (op.dom) reasons.push('DOM 依赖');
  if (op.workerOnly) reasons.push('仅 Worker');
  if (op.interactive) reasons.push('需交互');

  const row = {
    opId: op.id,
    cat: op.cat || '',
    name: op.name || '',
    dirs,
    acceptsBytes: op.acceptsBytes === true,
    paramCount: params.length,
    paramTypes: [...new Set(params.map((p) => p.type || 'text'))].sort().join('|'),
    fieldCount: fields.length,
    fieldKeys: fields.map((f) => f.key).join('|'),
    reasons,
  };

  if (reasons.length) buckets.blocked.push(row);
  else if (fields.length) buckets.fields.push(row);
  else if (op.acceptsBytes) buckets.bytes.push(row);
  else buckets.text.push(row);
  rows.push(row);
}

const summary = {
  schemaVersion: 1,
  scannedAt: new Date().toISOString(),
  total: OPS.length,
  counts: {
    textBatchable: buckets.text.length,
    bytesBatchable: buckets.bytes.length,
    fieldsBatchable: buckets.fields.length,
    blocked: buckets.blocked.length,
  },
  blockedReasons: buckets.blocked.reduce((acc, r) => {
    for (const x of r.reasons) acc[x] = (acc[x] || 0) + 1;
    return acc;
  }, {}),
  rows,
};

mkdirSync('资料/工程留存/MT800', { recursive: true });
writeFileSync('资料/工程留存/MT800/capability-scan.json', JSON.stringify(summary, null, 2));
const header = 'opId,cat,dirs,acceptsBytes,paramCount,paramTypes,fieldCount,fieldKeys,reasons';
const csv = [header, ...rows.map((r) => [
  r.opId, r.cat, r.dirs.join('|'), r.acceptsBytes, r.paramCount, r.paramTypes, r.fieldCount,
  r.fieldKeys.replace(/"/g, '""'), r.reasons.join('|'),
].map((v) => (/[",\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v))).join(','))].join('\r\n') + '\r\n';
writeFileSync('资料/工程留存/MT800/capability-scan.csv', csv);

console.log(JSON.stringify({
  total: summary.total,
  counts: summary.counts,
  blockedReasons: summary.blockedReasons,
  sampleText: buckets.text.slice(0, 12).map((r) => r.opId),
  sampleBytes: buckets.bytes.slice(0, 12).map((r) => r.opId),
  sampleFields: buckets.fields.slice(0, 12).map((r) => r.opId),
}, null, 2));
