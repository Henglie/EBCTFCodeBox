#!/usr/bin/env node
/*
 * 批任务 CSV 合同自检（M 侧）：
 * 覆盖批任务 CSV 合同 v1——模板与说明分离、显式空值不替默认、缺列才用默认、
 * RFC4180 解析、类型转换与逐行错误定位。
 * 仅依赖 src/core/batchCsv.js，不碰 UI/Worker/网络。
 */
import { buildTemplate, parseCsvTable, tasksFromCsv, CSV_SCHEMA_VERSION } from '../src/core/batchCsv.js';

const checks = [];
const ok = (name, cond, detail) => checks.push({ name, status: cond ? 'PASS' : 'FAIL', ...(detail ? { detail } : {}) });
const err = (r, code) => r.errors.some((e) => e.code === code);

const schema = {
  columns: [
    { key: 'taskId', type: 'text', required: true },
    { key: 'opId', type: 'text', required: true },
    { key: 'direction', type: 'enum', options: ['run', 'encode', 'decode'], default: 'encode' },
    { key: 'inputKind', type: 'enum', options: ['text', 'bytes', 'file', 'none'], default: 'text' },
    { key: 'input', type: 'text' },
    { key: 'param.key', type: 'text', default: 'key' },
    { key: 'param.shift', type: 'number', default: 3 },
    { key: 'param.flag', type: 'bool', default: false },
  ],
};

// --- 1. 模板：数据文件里不得出现说明注释 ---
const tpl = buildTemplate(schema);
ok('模板 CSV 不含 # 注释行', !tpl.csv.split(/\r?\n/).some((l) => l.trimStart().startsWith('#')), tpl.csv.slice(0, 80));
ok('模板 CSV 只有表头 + 样例行', tpl.csv.trim().split(/\r\n|\n/).length === 2);
ok('模板表头为合同列序', tpl.csv.split(/\r?\n/)[0] === 'taskId,opId,direction,inputKind,input,param.key,param.shift,param.flag');
ok('说明是独立对象且覆盖全部列', tpl.instructions.columns.length === schema.columns.length && tpl.instructions.schemaVersion === CSV_SCHEMA_VERSION);
ok('说明声明显式空值策略', tpl.instructions.columns.every((c) => c.empty === (c.required ? 'rejected' : 'kept-empty')));
ok('模板不写死任何密钥值', !/key=/.test(tpl.csv) && !tpl.csv.includes('secret'));

// --- 2. RFC4180 基础解析 ---
const basic = parseCsvTable('taskId,opId\r\n"t1","base64"\r\n');
ok('CRLF 基础解析', basic.header.length === 2 && basic.rows.length === 1 && basic.rows[0].cells[0].value === 't1');
ok('BOM 被剥离', parseCsvTable('\uFEFFtaskId,opId\r\nt1,base64\r\n').header[0] === 'taskId');
const quoted = parseCsvTable('taskId,input\r\nt1,"a,b""c"\r\n');
ok('引号内逗号与双引号转义', quoted.rows[0].cells[1].value === 'a,b"c' && quoted.rows[0].cells[1].quoted === true);
const multiline = parseCsvTable('taskId,input\r\nt1,"line1\nline2"\r\nt2,x\r\n');
ok('引号内换行归一个单元格', multiline.rows.length === 2 && multiline.rows[0].cells[1].value === 'line1\nline2');
ok('未闭合引号报错', parseCsvTable('taskId,input\r\nt1,"open\r\n').errors.some((e) => e.code === 'CSV_UNCLOSED_QUOTE'));
ok('重复表头报错', (() => { try { parseCsvTable('taskId,taskId\r\nt1,t2\r\n'); return false; } catch (e) { return e.code === 'CSV_DUPLICATE_HEADER'; } })());

// --- 3. 显式空值 vs 缺列 ---
const explicitEmpty = tasksFromCsv('taskId,opId,input,param.key\r\nt1,base64,,""\r\n', schema);
ok('显式空 input 保持空字符串', explicitEmpty.tasks[0].input === '');
ok('显式空 text 参数不被默认值顶替', explicitEmpty.tasks[0].params.key === '', JSON.stringify(explicitEmpty.tasks[0].params));
const missingCol = tasksFromCsv('taskId,opId,input\r\nt1,base64,abc\r\n', schema);
ok('缺列才使用声明默认值', missingCol.tasks[0].params.key === 'key' && missingCol.tasks[0].params.shift === 3);
ok('缺列 bool 默认 false 被保留', missingCol.tasks[0].params.flag === false);
ok('缺 direction 列时不写死方向', !('direction' in missingCol.tasks[0]));
ok('显式空 number 报错而非当 0', (() => {
  const r = tasksFromCsv('taskId,opId,param.shift\r\nt1,base64,\r\n', schema);
  return err(r, 'CSV_EMPTY_VALUE') && r.tasks.length === 0;
})());

// --- 4. 类型转换与字符串保真 ---
const typed = tasksFromCsv('taskId,opId,input,param.shift,param.flag,direction\r\nt1,caesar,abc,3,true,encode\r\n', schema);
ok('number 列转为数字', typed.tasks[0].params.shift === 3 && typeof typed.tasks[0].params.shift === 'number');
ok('bool 列接受 true', typed.tasks[0].params.flag === true);
ok('enum 列通过', typed.tasks[0].direction === 'encode');
ok('非法 enum 报错', err(tasksFromCsv('taskId,opId,direction\r\nt1,caesar,sideways\r\n', schema), 'CSV_ENUM'));
ok('非法 bool 报错', err(tasksFromCsv('taskId,opId,param.flag\r\nt1,caesar,yes\r\n', schema), 'CSV_BOOL'));
ok('前导零按字符串保留', tasksFromCsv('taskId,opId,input,param.key\r\nt1,base64,007,007\r\n', schema).tasks[0].params.key === '007');
ok('大整数字符串不丢精度', tasksFromCsv('taskId,opId,input,param.key\r\nt1,base64,x,123456789012345678901\r\n', schema).tasks[0].params.key === '123456789012345678901');

// --- 5. 行级错误不吞行 ---
const shortRow = tasksFromCsv('taskId,opId,input\r\nt1,base64\r\n', schema);
ok('短行报错', err(shortRow, 'CSV_ROW_WIDTH') && shortRow.tasks.length === 0);
const longRow = tasksFromCsv('taskId,opId,input\r\nt1,base64,a,b\r\n', schema);
ok('多列报错', err(longRow, 'CSV_ROW_WIDTH'));
ok('缺 taskId 报错', err(tasksFromCsv('taskId,opId,input\r\n,base64,a\r\n', schema), 'CSV_TASK_ID'));
ok('缺 opId 报错', err(tasksFromCsv('taskId,opId,input\r\nt1,,a\r\n', schema), 'CSV_OP_ID'));
ok('未知表头报错并阻断整批', (() => {
  const r = tasksFromCsv('taskId,opId,bogus\r\nt1,base64,x\r\n', schema);
  return err(r, 'CSV_UNKNOWN_HEADER') && r.tasks.length === 0;
})());
const mixed = tasksFromCsv('taskId,opId,param.shift\r\nt1,base64,2\r\nt2,base64,oops\r\nt3,base64,5\r\n', schema);
ok('单行类型错误不阻断后续行', mixed.tasks.length === 2 && mixed.tasks[1].taskId === 't3');

// --- 6. 其他合同点 ---
ok('空输入合法', tasksFromCsv('taskId,opId,input\r\nt1,md5,\r\n', schema).tasks[0].input === '');
ok('全空行被跳过', parseCsvTable('taskId,opId\r\nt1,base64\r\n\r\n').rows.length === 1);
ok('task 带 schemaVersion=1', missingCol.tasks[0].schemaVersion === 1);
ok('rollout 外的 op 被拒绝', err(tasksFromCsv('taskId,opId\r\nt1,notAnOp\r\n', schema, { ops: ['base64'] }), 'CSV_OP_UNSUPPORTED'));
ok('field 命名空间进 fields', (() => {
  const s2 = { columns: [...schema.columns, { key: 'field.textB', type: 'text' }] };
  const r = tasksFromCsv('taskId,opId,input,field.textB\r\nt1,diffTool,a,b\r\n', s2);
  return r.tasks[0].fields.textB === 'b';
})());

const failed = checks.filter((c) => c.status !== 'PASS');
const out = { verdict: failed.length ? 'FAIL' : 'PASS', checks: checks.length, failed: failed.length, failures: failed };
console.log(JSON.stringify(out, null, 2));
if (failed.length) process.exitCode = 1;
