import { OPS, COVERAGE, COVERAGE_STATS } from "../ops/auto-e4.js";

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
  ok(String(out).includes(sub), label, `missing=${JSON.stringify(sub)} out=${String(out).slice(0, 400)}`);
}
function throws(fn, label) {
  try { fn(); ok(false, label, "expected throw"); } catch { pass++; }
}

const NS = "dcode-extras-2026-10/";
const by = new Map(OPS.map((o) => [o.id, o]));
const op = (s) => by.get(NS + "e4-" + s);
const run = (s, t, p) => op(s).run(t, p);
const enc = (s, t, p) => op(s).encode(t, p);
const dec = (s, t, p) => op(s).decode(t, p);

eq(OPS.length, 13, "op 数量 = 13");
ok(OPS.every((o) => o.id.startsWith(NS + "e4-")), "所有 op id 以 e4- 开头");
ok(new Set(OPS.map((o) => o.id)).size === OPS.length, "op id 唯一");
ok(OPS.every((o) => [NS + "cat-text", NS + "cat-cipher", NS + "cat-numeral", NS + "cat-math"].includes(o.cat)), "op 分类合法");

const c93Known = "1010111101101000101001011001100101001100100101000010101010000101000101101100110101010111101";
has(enc("code93", "CODE93"), c93Known, "Code93 CODE93 模块串与 bwip-js 已知答案一致");
eq(dec("code93", c93Known), "CODE93", "Code93 已知模块串解码");
has(enc("code93", "C"), "110100010", "Code93 C 码字");
eq(dec("code93", enc("code93", "Hello, World! 123 {x}").split("模块串: ")[1]), "Hello, World! 123 {x}", "Code93 Full ASCII 往返");
throws(() => dec("code93", c93Known.slice(0, 63) + "100010100" + c93Known.slice(72)), "Code93 篡改校验位报错");
throws(() => enc("code93", "中文"), "Code93 非 ASCII 报错");

has(enc("codabar", "0"), "A1111122B", "Codabar 0 宽度串");
has(enc("codabar", "0"), "101010001110", "Codabar 0 模块串（dCode 示例）");
eq(dec("codabar", "A1111122B"), "0", "Codabar 0 解码");
eq(dec("codabar", enc("codabar", "0123456789-$:/.+").split("宽度串: ")[1].split("\n")[0]), "0123456789-$:/.+", "Codabar 全字符往返");
throws(() => enc("codabar", "12E34"), "Codabar 非法字符报错");

eq(enc("postal-fr", "75001"), ".|.||| ..|||| ..|||| |.|.|| ||..||", "法国邮政 75001 已知答案");
eq(dec("postal-fr", ".|.||| ..|||| ..|||| |.|.|| ||..||"), "75001", "法国邮政 75001 解码");
eq(dec("postal-fr", enc("postal-fr", "1234567890")), "1234567890", "法国邮政 10 位往返");
throws(() => enc("postal-fr", "75A01"), "法国邮政非数字报错");

has(run("trevanion", "Ce site , je d ois le dire , dé c hire ! Tr o p de bons outils , de d échiffrements automatiques . Qu e l talent !", { offset: "3" }), "DCODE", "Trevanion N=3 已知答案");
has(run("trevanion", "Bonjour! Comment ça va ? Alors, ça roule ? Hier je pensais à toi et ta femme, elle va bien ?", { offset: "1" }), "CAÇHE", "Trevanion N=1 已知答案");
throws(() => run("trevanion", "a! b", { offset: "0" }), "Trevanion 偏移 0 报错");

eq(enc("digrafid", "DCODE"), "MOLGAZ", "Digrafid DCODE 已知答案");
eq(dec("digrafid", "MOLGAZ"), "DCODE", "Digrafid MOLGAZ 解码");
eq(dec("digrafid", enc("digrafid", "HELLOWORLD", { grid1Key: "SECRET", grid2Key: "KEY" }), { grid1Key: "SECRET", grid2Key: "KEY" }), "HELLOWORLD", "Digrafid 关键字格往返");
throws(() => enc("digrafid", "!!!"), "Digrafid 空明文报错");

eq(enc("charabia", "LATIN", { suffix: "US" }), "NITALUS", "Charabia LATIN 已知答案");
eq(dec("charabia", "NITALUS"), "LATIN", "Charabia NITALUS 解码");
eq(dec("charabia", "NITALUM"), "LATIN", "Charabia -UM 解码");
eq(dec("charabia", enc("charabia", "HELLO WORLD", { suffix: "AE" })), "HELLO WORLD", "Charabia 后缀往返");
throws(() => enc("charabia", "X", { suffix: "123" }), "Charabia 非法后缀报错");

const bfA = "+".repeat(65) + ".";
has(dec("alphuck", enc("alphuck", bfA)), "输出 (1 字节): A", "Alphuck 执行 +65 输出 A");
has(dec("alphuck", "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeej"), "输出 (1 字节): A", "Alphuck 直接执行");
throws(() => dec("alphuck", "p"), "Alphuck 未闭合循环报错");

eq(enc("binaryfuck", "+"), "000", "Binaryfuck + = 000");
eq(enc("binaryfuck", ","), "101", "Binaryfuck , = 101");
const bfBin = "000000000000000000000000000000110010000010000000000010000000000000000000000010000000000000000000000000000000011011011011001111010010010001001001001100000000000000000000000100000000000000000100";
has(dec("binaryfuck", bfBin), "输出 (3 字节): BIN", "Binaryfuck dCode 示例输出 BIN");
throws(() => dec("binaryfuck", "0000"), "Binaryfuck 非 3 倍数报错");

const pikaPokemon = "pi pi pi pi pi pi pi pi pi pi pika pipi pi pipi pi pi pi pipi pi pi pi pi pi pi pi pipi pi pi pi pi pi pi pi pi pi pi pichu pichu pichu pichu ka chu pipi pipi pipi pi pi pi pi pi pi pi pi pi pi pikachu pipi pi pi pi pi pi pi pi pi pi pi pi pikachu ka ka ka ka pikachu ka ka ka ka ka ka pikachu pi pi pi pi pi pi pi pi pikachu pi pi pikachu ka pikachu";
has(dec("pikalang", pikaPokemon), "输出 (7 字节): Pokemon", "Pikalang dCode 示例输出 Pokemon");
eq(enc("pikalang", "+"), "pi", "Pikalang + = pi");
has(dec("pikalang", enc("pikalang", bfA)), "输出 (1 字节): A", "Pikalang +65 输出 A");

eq(enc("reversefuck", "+-<>[].,"), "-+><][,.", "ReverseFuck 运算符取反");
has(dec("reversefuck", enc("reversefuck", bfA)), "输出 (1 字节): A", "ReverseFuck +65 输出 A");
throws(() => dec("reversefuck", "-".repeat(65) + ",".repeat(2) + ">"), "ReverseFuck 指针越界报错");

eq(run("crypt", "dCode", { salt: "secret" }), "$1$secret$xoy1MxMutYIelML2TYUkO.", "crypt MD5 已知向量");
eq(run("crypt", "dCode", { salt: "$5$secret$" }), "$5$secret$BG4MkQdYxdLv2KOoRkK.3omTkZhME3rKNpREJ3pgmI8", "crypt SHA-256 已知向量");
eq(run("crypt", "dCode", { salt: "$5$rounds=1000$secret$" }), "$5$rounds=1000$secret$u7jT3DrLqkzDTW.cDH1cbH/rTlzBzORpz21lXFJWkUD", "crypt SHA-256 rounds=1000 已知向量");
eq(run("crypt", "dCode", { salt: "secret", algo: "sha256" }), "$5$secret$BG4MkQdYxdLv2KOoRkK.3omTkZhME3rKNpREJ3pgmI8", "crypt plain salt + sha256");
throws(() => run("crypt", "dCode", { salt: "$2y$10$abcdefghijklmnopqrstuv" }), "crypt bcrypt 明确报错");

const geek = "GCS d-- s:+ a22 C+++ UB++ PGP t+ 5? tv+ b+ DI+ D+ e* h! r-- y?";
has(run("geek", geek), "d-- → 着装 (Dress): -2", "Geek Code d-- 解析");
has(run("geek", geek), "C+++ → 计算机 (Computers): +3", "Geek Code C+++ 解析");
has(run("geek", geek), "a22 → 年龄 (Age): 数值 22", "Geek Code a22 解析");
has(run("geek", geek), "GCS → 标头/版本", "Geek Code GCS 标头");
has(run("geek", "C++ C--"), "C-- → 计算机 (Computers): -2", "Geek Code C-- 解析");
throws(() => run("geek", "@@@"), "Geek Code 无类别报错");

has(run("pairs", "A/B\nC/D\nE/F\nG/H"), "第 3 轮", "固定搭档 4 队 3 轮");
has(run("pairs", "A/B\nC/D\nE/F\nG/H"), "A/B vs C/D", "固定搭档对阵");
has(run("pairs", "A/B\nC/D\nE/F"), "轮空", "固定搭档奇数队轮空");
throws(() => run("pairs", "A/B"), "固定搭档少于 2 队报错");

eq(COVERAGE.length, 90, "覆盖台账 90 条");
ok(COVERAGE.every((e) => ["implemented", "mapped", "blocked"].includes(e.status)), "覆盖状态三态");
ok(COVERAGE.every((e) => [NS + "cat-text", NS + "cat-cipher", NS + "cat-numeral", NS + "cat-math"].includes(e.cat)), "覆盖分类合法");
ok(COVERAGE.filter((e) => e.status === "implemented").every((e) => by.has(e.op)), "implemented 指向存在的 op");
ok(COVERAGE.filter((e) => e.status === "mapped").every((e) => e.target && String(e.target).length > 0), "mapped 目标非空");
ok(COVERAGE.filter((e) => e.status === "blocked").every((e) => e.reason && String(e.reason).length > 0), "blocked 原因非空");
ok(COVERAGE.every((e) => String(e.name).length > 0 && e.slug !== undefined && String(e.sourceCat).length > 0), "覆盖条目名称/来源分类完整");
const covered = new Set(COVERAGE.filter((e) => e.status === "implemented").map((e) => e.op));
ok(OPS.every((o) => covered.has(o.id)), "每个 op 至少覆盖一条工具");
eq(COVERAGE_STATS.entries, 90, "统计条目 90");
eq(COVERAGE_STATS.byStatus.implemented, 16, "统计 implemented 16");
eq(COVERAGE_STATS.byStatus.mapped, 5, "统计 mapped 5");
eq(COVERAGE_STATS.byStatus.blocked, 69, "统计 blocked 69");
eq(COVERAGE_STATS.unique.implemented, 13, "唯一 implemented 13");
eq(COVERAGE_STATS.unique.mapped, 5, "唯一 mapped 5");
eq(COVERAGE_STATS.unique.blocked, 57, "唯一 blocked 57");
eq(COVERAGE_STATS.unique.implemented + COVERAGE_STATS.unique.mapped + COVERAGE_STATS.unique.blocked, 75, "唯一工具总数 75");
eq(COVERAGE.find((e) => e.slug === "keysmash-clavier").target, NS + "txt-keysmash", "keysmash 映射到既有 op");
eq(COVERAGE.find((e) => e.slug === "solveur-wordament").target, NS + "d3-boggle", "Wordament 映射到 d3-boggle");
eq(COVERAGE.find((e) => e.slug === "chiffre-swagman").target, NS + "d1-swagman", "Swagman 映射到 d1-swagman");
eq(COVERAGE.find((e) => e.slug === "4-quatre-elements").target, NS + "d1-four-elements", "四元素映射到 d1-four-elements");
eq(COVERAGE.find((e) => e.slug === "miniature-exif").target, "imageThumb", "EXIF 缩略图映射到主程序 imageThumb");
eq(COVERAGE.filter((e) => e.slug === "code-barres-code-93").length, 2, "Code93 两分类条目均覆盖");
eq(COVERAGE.filter((e) => e.slug === "code-barres-codabar").length, 2, "Codabar 两分类条目均覆盖");

if (fail) {
  console.error(`SELFTEST FAIL ${pass}/${pass + fail}`);
  for (const f of failures) console.error(" - " + f);
  process.exit(1);
}
console.log(`SELFTEST PASS ${pass}/${pass}`);
