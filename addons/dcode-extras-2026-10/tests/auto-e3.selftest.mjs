/*
 * dcode-extras · Agent E3 自测
 * 运行：node addons/dcode-extras-2026-10/tests/auto-e3.selftest.mjs
 *
 * 每个 e3-* op 至少一条已知向量/往返/结构断言；末尾核对 42 条台账
 * （41 个 D3 blocked 重审 + 1 个 Kakuro 升级）的 implemented/mapped/blocked 计数。
 */

import { OPS, COVERAGE } from "../ops/auto-e3.js";

let pass = 0, fail = 0;
const failures = [];

function ok(cond, label, detail) {
  if (cond) { pass++; return; }
  fail++;
  failures.push(`${label}${detail ? ` :: ${detail}` : ""}`);
}
function eq(actual, expected, label) {
  ok(actual === expected, label, `expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`);
}
function has(out, sub, label) {
  ok(String(out).includes(sub), label, `missing=${JSON.stringify(sub)} out=${String(out).slice(0, 500)}`);
}
function notHas(out, sub, label) {
  ok(!String(out).includes(sub), label, `unexpected=${JSON.stringify(sub)} out=${String(out).slice(0, 500)}`);
}
function thrown(fn, label) {
  try { fn(); ok(false, label, "expected throw"); }
  catch { pass++; }
}

const by = new Map(OPS.map((o) => [o.id, o]));
const run = (id, text, p) => by.get(id).run(text, p);
const missing = (id) => ok(by.has(id), `op 存在 ${id}`);

// ---------- 模块/台账结构 ----------
eq(OPS.length, 11, "OPS 数量 = 11");
eq(new Set(OPS.map((o) => o.id)).size, OPS.length, "op id 无重复");
const CATS = new Set(["dcode-extras-2026-10/cat-game", "dcode-extras-2026-10/cat-text", "dcode-extras-2026-10/cat-numeral"]);
for (const op of OPS) {
  ok(op.id.startsWith("e3-"), `id 前缀 e3- (${op.id})`);
  ok(CATS.has(op.cat), `分类合法 (${op.id})`);
  ok(op.name && op.desc, `op 元数据完整 (${op.id})`);
  ok(typeof op.run === "function", `op 可执行 (${op.id})`);
}

eq(COVERAGE.length, 42, "台账条目 = 42（41 blocked 重审 + Kakuro 升级）");
const statusCount = { implemented: 0, mapped: 0, blocked: 0 };
for (const e of COVERAGE) {
  ok(e.cat && e.name && e.slug && e.url, `台账字段完整 (${e.cat} / ${e.name})`);
  eq(e.url, `https://www.dcode.fr/${e.slug}`, `台账 URL 由 slug 生成 (${e.slug})`);
  ok(e.status === "implemented" || e.status === "mapped" || e.status === "blocked", `台账状态合法 (${e.name})`);
  statusCount[e.status]++;
  if (e.status === "implemented") ok(by.has(e.op), `implemented op 已注册 (${e.name} → ${e.op})`);
  if (e.status === "mapped") ok(Boolean(e.op), `mapped 有指向 (${e.name})`);
  if (e.status === "blocked") ok(Boolean(e.reason), `blocked 有原因 (${e.name})`);
  ok(!String(e.reason || "").includes("台账缺失"), `台账无内部缺口 (${e.name})`);
}
eq(statusCount.implemented, 12, "台账 implemented = 12");
eq(statusCount.mapped, 7, "台账 mapped = 7");
eq(statusCount.blocked, 23, "台账 blocked = 23");
eq(statusCount.implemented + statusCount.mapped + statusCount.blocked, 42, "台账计数合计 = 42");
eq(new Set(COVERAGE.map((e) => `${e.cat}\t${e.name}`)).size, COVERAGE.length, "分类内名称无重复");
eq(COVERAGE.filter((e) => e.tag === "upgrade").length, 1, "Kakuro 升级条目 = 1");
eq(COVERAGE.filter((e) => !e.tag).length, 41, "D3 blocked 重审条目 = 41");

// ---------- 1 Fill-A-Pix ----------
missing("e3-fillapix");
const fpAll = run("e3-fillapix", "...\n.9.\n...");
has(fpAll, "###\n###\n###", "fillapix center 9 all filled");
has(fpAll, "线索 1 条全部满足", "fillapix clue check");
const fpNone = run("e3-fillapix", "...\n.0.\n...");
has(fpNone, "...\n...\n...", "fillapix center 0 all empty");
const fpExclude = run("e3-fillapix", "...\n.8.\n...", { center: "exclude" });
has(fpExclude, "###\n#.#\n###", "fillapix exclude center 8");
thrown(() => run("e3-fillapix", "0..\n.9.\n..."), "fillapix contradiction throws");
thrown(() => run("e3-fillapix", "?9"), "fillapix bad grid throws");

// ---------- 2 Tectonic ----------
missing("e3-tectonic");
const tect = run("e3-tectonic", `6
000111
000111
222333
222333
444555
444555
===
1.....
..6...
....6.
.2....
...1..
.....5`);
has(tect, "1 5 3 1 6 3", "tectonic row 1");
has(tect, "4 2 6 4 2 5", "tectonic row 2");
has(tect, "区域大小 6,6,6,6,6,6", "tectonic region sizes");
has(tect, "校验：区域唯一", "tectonic check note");
thrown(() => run("e3-tectonic", "1\n0\n===\n."), "tectonic bad n throws");
thrown(() => run("e3-tectonic", "2\n00\n0\n===\n..\n.."), "tectonic bad region row throws");

// ---------- 3 任意区域数独 ----------
missing("e3-sudoku-regions");
const sud5 = run("e3-sudoku-regions", `5
00000
11111
22222
33333
44444
===
.....
....1
...12
..123
.1234`);
has(sud5, "1 2 3 4 5", "sudoku5 first row");
has(sud5, "5 1 2 3 4", "sudoku5 last row");
has(sud5, "区域数独 5×5 解", "sudoku5 header");
const sud7 = run("e3-sudoku-regions", `7
0000000
1111111
2222222
3333333
4444444
5555555
6666666
===
.......
......1
.....12
....123
...1234
..12345
.123456`);
has(sud7, "1 2 3 4 5 6 7", "sudoku7 first row");
has(sud7, "7 1 2 3 4 5 6", "sudoku7 last row");
thrown(() => run("e3-sudoku-regions", "5\n00000\n11111\n22222\n33333\n44444\n===\n11234\n.....\n.....\n.....\n....."), "sudoku duplicate given throws");
thrown(() => run("e3-sudoku-regions", "3\n000\n111\n222\n===\n1Z3\n...\n..."), "sudoku bad symbol throws");

// ---------- 4 列移位密钥恢复 ----------
missing("e3-keyrecover");
const kr = run("e3-keyrecover", "LWLEORHLOD\n===\nhello\nworld", { crib: "WORLD", maxlen: "3" });
has(kr, "HELLOWORLD", "keyrecover plaintext");
has(kr, "列读取顺序 [2 1 0]", "keyrecover order");
has(kr, "命中 crib「WORLD」", "keyrecover crib hit");
const kr2 = run("e3-keyrecover", "LWLEORHLOD\n===\nhello\nworld", { maxlen: "3" });
has(kr2, "HELLOWORLD", "keyrecover wordlist only");
has(kr2, "词表覆盖评分", "keyrecover word score");
thrown(() => run("e3-keyrecover", "ABC", { maxlen: "3" }), "keyrecover short ciphertext throws");

// ---------- 5 MRZ ----------
missing("e3-mrz");
const mrz3 = run("e3-mrz", `P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<
L898902C36UTO7408122F1204159ZE184226B<<<<<10`);
has(mrz3, "MRZ 版式：TD3", "mrz TD3 format");
has(mrz3, "ERIKSSON, ANNA MARIA", "mrz TD3 name");
has(mrz3, "1974-08-12", "mrz TD3 birth");
has(mrz3, "2012-04-15", "mrz TD3 expiry");
has(mrz3, "校验：全部通过", "mrz TD3 checks");
const mrz1 = run("e3-mrz", `I<UTOD231458907<<<<<<<<<<<<<<<
7408122F1204159UTO<<<<<<<<<<<6
ERIKSSON<<ANNA<MARIA<<<<<<<<<<`);
has(mrz1, "MRZ 版式：TD1", "mrz TD1 format");
has(mrz1, "D23145890", "mrz TD1 doc number");
has(mrz1, "校验：全部通过", "mrz TD1 checks");
const mrzBad = run("e3-mrz", `P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<
L898902C36UTO7408122F1204159ZE184226B<<<<<20`);
has(mrzBad, "校验：失败", "mrz bad check flagged");
const mrzJoined = run("e3-mrz", "P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<L898902C36UTO7408122F1204159ZE184226B<<<<<10");
has(mrzJoined, "MRZ 版式：TD3", "mrz single-line joined");
thrown(() => run("e3-mrz", "P<UTO\nSHORT"), "mrz bad length throws");

// ---------- 6 扫雷 / Picture Sweep ----------
missing("e3-minesweeper");
const msDeduce = run("e3-minesweeper", "1F\n??", { mode: "deduce" });
has(msDeduce, "安全格 2", "minesweeper deduce safe count");
has(msDeduce, "(2,1)", "minesweeper safe 2,1");
has(msDeduce, "(2,2)", "minesweeper safe 2,2");
has(msDeduce, "雷格 0", "minesweeper deduce no new mine");
const msSolve = run("e3-minesweeper", "1F\n??", { mode: "solve" });
has(msSolve, "唯一解", "minesweeper unique");
has(msSolve, "1*\n..", "minesweeper solution grid");
const msMulti = run("e3-minesweeper", "1?\n??", { mode: "solve" });
has(msMulti, "多解", "minesweeper multi solution");
thrown(() => run("e3-minesweeper", "??\n??", { mode: "deduce" }), "minesweeper no clue throws");

// ---------- 7 六边形词盘 ----------
missing("e3-hexword");
const hw = run("e3-hexword", `C A T
 A R E
D O G
===
cat
are
dog
zzz`);
has(hw, "cat (3)", "hexword cat");
has(hw, "are (3)", "hexword are");
has(hw, "dog (3)", "hexword dog");
notHas(hw, "zzz", "hexword excludes absent word");
thrown(() => run("e3-hexword", "C A T\n A R E\nD O G"), "hexword missing wordlist throws");
thrown(() => run("e3-hexword", "CAT\nAR\n===\ncat"), "hexword short rows throws");

// ---------- 8 填字网格 ----------
missing("e3-crossword");
const cw = run("e3-crossword", `...
...
...
===
cat
are
ten`, { reuse: "yes" });
has(cw, "CAT\nARE\nTEN", "crossword word square");
has(cw, "填字 3×3 解", "crossword header");
has(cw, "竖 (1,1) 3 格", "crossword down slot");
const cwNo = run("e3-crossword", `...
...
...
===
cat
dog`, { reuse: "yes" });
has(cwNo, "无解", "crossword no solution");
thrown(() => run("e3-crossword", "...\n...\n..."), "crossword missing wordlist throws");

// ---------- 9 Kakuro ----------
missing("e3-kakuro");
const kak = run("e3-kakuro", `# # D3 D4
# A3 . .
# A4 . .
# # # #`);
has(kak, "2 1", "kakuro row 2 1");
has(kak, "1 3", "kakuro row 1 3");
has(kak, "Kakuro 4×4 解", "kakuro header");
has(kak, "词槽 4 段", "kakuro run count");
thrown(() => run("e3-kakuro", `# # D2 D4
# A3 . .
# A4 . .
# # # #`), "kakuro impossible sum throws");

// ---------- 10 吉他和弦 ----------
missing("e3-guitar");
const gt = run("e3-guitar", "C Am G7 F#m7b5");
has(gt, "C (C E G)", "guitar C tones");
has(gt, "指法 x32010", "guitar C fingering");
has(gt, "Am (A C E)", "guitar Am tones");
has(gt, "指法 x02210", "guitar Am fingering");
has(gt, "G7 (G B D F)", "guitar G7 tones");
has(gt, "F#m7b5 (F# A C E)", "guitar F#m7b5 tones");
has(gt, "E |--x--", "guitar low E line");
thrown(() => run("e3-guitar", "Cxyz"), "guitar unknown quality throws");

// ---------- 11 文本五线谱 ----------
missing("e3-staff");
const st = run("e3-staff", "C4 D4 E4 F4 G4 A4 B4 C5");
has(st, "C4(60)", "staff C4 midi");
has(st, "C5(72)", "staff C5 midi");
has(st, "C D E F G A B c|", "staff ABC line");
has(st, "30 =|--E-----", "staff E4 line");
has(st, "38 =|--------", "staff F5 line");
const stSol = run("e3-staff", "do4 re4 mi4");
has(stSol, "C4(60) D4(62) E4(64)", "staff solfege");
const stDur = run("e3-staff", "A4/8");
has(stDur, "A/2|", "staff eighth duration");
thrown(() => run("e3-staff", "H4"), "staff bad note throws");

console.log(`\nAUTO-E3 SELFTEST ${fail === 0 ? "PASS" : "FAIL"} ${pass}/${pass + fail} assertions`);
if (fail) {
  console.error(failures.join("\n"));
  process.exit(1);
}



