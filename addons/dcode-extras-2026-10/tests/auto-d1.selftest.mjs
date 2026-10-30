import { OPS, COVERAGE, COVERAGE_COUNTS } from "../ops/auto-d1.js";

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
  ok(String(out).includes(sub), label, `missing=${JSON.stringify(sub)} out=${String(out).slice(0, 240)}`);
}
function thrown(fn, label) {
  try { fn(); ok(false, label, "expected throw"); }
  catch { pass++; }
}

const by = new Map(OPS.map((o) => [o.id, o]));
const enc = (id, text, p) => by.get(id).encode(text, p);
const dec = (id, text, p) => by.get(id).decode(text, p);
const run = (id, text, p) => by.get(id).run(text, p);

const allowedCats = new Set(["dcode-extras-2026-10/cat-symbol", "dcode-extras-2026-10/cat-cipher", "dcode-extras-2026-10/cat-text"]);
eq(OPS.length, 29, "d1 op 数 = 29");
eq(new Set(OPS.map((o) => o.id)).size, OPS.length, "d1 op id 无重复");
for (const op of OPS) {
  ok(op.id.startsWith("d1-"), `op id 以 d1- 开头 ${op.id}`);
  ok(allowedCats.has(op.cat), `op 分类合法 ${op.id}`);
  ok(Array.isArray(op.params), `op params 数组 ${op.id}`);
  ok(typeof op.encode === "function" || typeof op.decode === "function" || typeof op.run === "function", `op 有 encode/decode/run ${op.id}`);
}

eq(COVERAGE.length, 269, "COVERAGE 条目 = 269");
eq(COVERAGE_COUNTS.implemented, 34, "implemented 条目 = 34");
eq(COVERAGE_COUNTS.mapped, 111, "mapped 条目 = 111");
eq(COVERAGE_COUNTS.blocked, 124, "blocked 条目 = 124");
const catCount = {};
for (const e of COVERAGE) catCount[e.cat] = (catCount[e.cat] || 0) + 1;
eq(catCount.symbols, 231, "symbols 条目 = 231");
eq(catCount.grid, 15, "grid 条目 = 15");
eq(catCount.beliefs, 10, "beliefs 条目 = 10");
eq(catCount.history, 7, "history 条目 = 7");
eq(catCount.homophonic, 6, "homophonic 条目 = 6");
eq(new Set(COVERAGE.map((e) => `${e.cat}|${e.slug}`)).size, COVERAGE.length, "COVERAGE cat+slug 无重复");

const opIds = new Set(OPS.map((o) => o.id));
const implOps = new Set();
for (const e of COVERAGE) {
  ok(typeof e.name === "string" && e.name.length > 0, `ledger name ${e.slug}`);
  ok(typeof e.slug === "string" && e.slug.length > 0, `ledger slug ${e.slug}`);
  ok(/^https:\/\/www\.dcode\.fr\//.test(e.url), `ledger url ${e.slug}`);
  ok(["implemented", "mapped", "blocked"].includes(e.status), `ledger status ${e.slug}`);
  if (e.status === "implemented") {
    ok(opIds.has(e.op), `implemented op 存在 ${e.slug} -> ${e.op}`);
    implOps.add(e.op);
  } else if (e.status === "mapped") {
    ok(typeof e.op === "string" && e.op.length > 0, `mapped op 非空 ${e.slug}`);
  } else {
    ok(typeof e.reason === "string" && e.reason.length > 0, `blocked reason 非空 ${e.slug}`);
  }
}
for (const op of OPS) ok(implOps.has(op.id), `op 被 ledger 引用 ${op.id}`);

eq(enc("d1-playfair", "HELLO", { key: "MONARCHY" }), "CFSUPM", "playfair HELLO 向量");
eq(dec("d1-playfair", "CFSUPM", { key: "MONARCHY" }), "HELLO", "playfair 解密");
eq(dec("d1-playfair", enc("d1-playfair", "ATTACKATDAWN", { key: "PLAYFAIR" }), { key: "PLAYFAIR" }), "ATTACKATDAWN", "playfair 往返");

eq(enc("d1-albhed", "HELLO"), "RAMMU", "al bhed HELLO");
eq(dec("d1-albhed", "RAMMU"), "HELLO", "al bhed 解密");

eq(enc("d1-code-claw", "RAT", { mode: "letters" }), "RBU", "code claw 字母 RAT");
eq(enc("d1-code-claw", "RAT", { mode: "claw" }), "\\/ |\\ //", "code claw 爪痕 RAT");
eq(dec("d1-code-claw", "\\/ |\\ //", { mode: "claw" }), "RAT", "code claw 爪痕解密");

const rankP = (extra = {}) => ({ anchor: "D", value: "3", scheme: "cyclic", ...extra });
eq(enc("d1-rank-anchor", "DCODE", rankP()), "3/2/14/3/4", "D3 向量");
eq(enc("d1-rank-anchor", "DCODE", rankP({ anchor: "K", value: "7" })), "26/25/11/26/1", "K7 向量");
eq(enc("d1-rank-anchor", "DCODE", rankP({ anchor: "K", value: "6" })), "25/24/10/25/26", "K6 向量");
eq(enc("d1-rank-anchor", "DCODE", rankP({ anchor: "N", value: "1" })), "17/16/2/17/18", "Indienne 向量");
eq(enc("d1-rank-anchor", "DCODE", rankP({ anchor: "K", value: "7", scheme: "reverse" })), "14/15/3/14/13", "K7 反向向量");
eq(enc("d1-rank-anchor", "DCODE", rankP({ anchor: "K", value: "7", scheme: "zero" })), "0/-1/11/0/1", "K7 零基向量");
eq(dec("d1-rank-anchor", "3/2/14/3/4", rankP()), "DCODE", "D3 解密");
eq(dec("d1-rank-anchor", "0/-1/11/0/1", rankP({ anchor: "K", value: "7", scheme: "zero" })), "DCODE", "K7 零基解密");

eq(enc("d1-greek-rank", "αβγ"), "1 2 3", "greek rank αβγ");
eq(enc("d1-greek-rank", "Ω"), "24", "greek rank Ω");
eq(dec("d1-greek-rank", "1 2 3"), "αβγ", "greek rank 解密");

eq(enc("d1-alpha-sum", "ABC"), "1 3 6", "alpha sum ABC");
eq(enc("d1-alpha-sum", "DCODE"), "4 7 22 26 31", "alpha sum DCODE");
eq(dec("d1-alpha-sum", "4 7 22 26 31"), "DCODE", "alpha sum 解密");
eq(enc("d1-alpha-sum", "ABC", { first: "0" }), "0 1 3", "alpha sum A=0");

eq(enc("d1-cv-rank", "DCODE", { mode: "both" }), "C3C2V4C3V2", "cv both");
eq(enc("d1-cv-rank", "DCODE", { mode: "consonants" }), "3 2 O 3 E", "cv consonants");
eq(enc("d1-cv-rank", "DCODE", { mode: "vowels" }), "D C 4 D 2", "cv vowels");
eq(dec("d1-cv-rank", "C3C2V4C3V2", { mode: "both" }), "DCODE", "cv both 解密");
eq(dec("d1-cv-rank", "3 2 O 3 E", { mode: "consonants" }), "DCODE", "cv consonants 解密");
eq(dec("d1-cv-rank", "D C 4 D 2", { mode: "vowels" }), "DCODE", "cv vowels 解密");

eq(enc("d1-prime-subst", "ABC"), "2 3 5", "prime subst ABC");
eq(enc("d1-prime-subst", "Z"), "101", "prime subst Z");
eq(dec("d1-prime-subst", "2 3 5"), "ABC", "prime subst 解密");

eq(enc("d1-prime-mult", "AB", { mode: "expLetter" }), "18", "prime mult AB");
eq(dec("d1-prime-mult", "18", { mode: "expLetter" }), "AB", "prime mult AB 解密");
eq(enc("d1-prime-mult", "DCODE", { mode: "expPos" }), "5097877527832031250000", "prime mult DCODE");
eq(dec("d1-prime-mult", "5097877527832031250000", { mode: "expPos" }), "DCODE", "prime mult DCODE 解密");

eq(enc("d1-mirror-digits", "2026"), "5059", "mirror digits 2026");
eq(dec("d1-mirror-digits", "5059"), "2026", "mirror digits 解密");
thrown(() => enc("d1-mirror-digits", "3"), "mirror digits 3 报错");

eq(enc("d1-ascii-shift", "A", { shift: "40" }), "i", "ascii shift A+40");
eq(dec("d1-ascii-shift", "i", { shift: "40" }), "A", "ascii shift 解密");
eq(dec("d1-ascii-shift", enc("d1-ascii-shift", "dCode", { shift: "-18" }), { shift: "-18" }), "dCode", "ascii shift 往返");

eq(enc("d1-progressive-caesar", "ABC", { step: "1", start: "0" }), "ACE", "progressive caesar ABC");
eq(dec("d1-progressive-caesar", "ACE", { step: "1", start: "0" }), "ABC", "progressive caesar 解密");
eq(dec("d1-progressive-caesar", enc("d1-progressive-caesar", "DCODE", { step: "3", start: "2" }), { step: "3", start: "2" }), "DCODE", "progressive caesar 往返");

eq(enc("d1-unicode-shift", "dCode", { shift: "1234" }), "ԶԕՁԶԷ", "unicode shift dCode");
eq(dec("d1-unicode-shift", "ԶԕՁԶԷ", { shift: "1234" }), "dCode", "unicode shift 解密");

eq(enc("d1-ascii-controls", "\u0000\u0001\u0002\u0003"), "NUL SOH STX ETX", "ascii controls 名称");
eq(dec("d1-ascii-controls", "NUL SOH STX ETX"), "\u0000\u0001\u0002\u0003", "ascii controls 名称解密");
eq(enc("d1-ascii-controls", "\u0000\u0001\u0002\u0003", { mode: "symbol" }), "␀ ␁ ␂ ␃", "ascii controls 图符");
eq(dec("d1-ascii-controls", "␀ ␁ ␂ ␃"), "\u0000\u0001\u0002\u0003", "ascii controls 图符解密");

eq(enc("d1-word-pattern", "BOB EVE"), "010 010", "word pattern BOB EVE");
has(dec("d1-word-pattern", "010", { words: "BOB,EVE,SMS,CAB" }), "BOB, EVE, SMS", "word pattern 候选");

eq(enc("d1-four-elements", "earth fire"), "🜃 🜂", "four elements earth fire");
eq(dec("d1-four-elements", "🜃 🜂"), "earth fire", "four elements 解密");

has(run("d1-chinese-zodiac", "2024"), "Dragon, Wood", "chinese zodiac 2024");
has(run("d1-chinese-zodiac", "2000"), "Dragon, Metal", "chinese zodiac 2000");
has(run("d1-chinese-zodiac", "2023"), "Rabbit, Water", "chinese zodiac 2023");
has(run("d1-chinese-zodiac", "Dragon"), "2024", "chinese zodiac 动物反查");

eq(enc("d1-wolseley", "WOLSELEY", { key: "SECRET", remove: "J" }), "RFIZYIYE", "wolseley 向量");
eq(dec("d1-wolseley", "RFIZYIYE", { key: "SECRET", remove: "J" }), "WOLSELEY", "wolseley 解密");

eq(enc("d1-swagman", "DCODESWAGMANCIPHER"), "DASHNECWAORCXGIDEPMX", "swagman 向量");
eq(dec("d1-swagman", "DASHNECWAORCXGIDEPMX"), "DCODESWAGMANCIPHER", "swagman 解密");

eq(dec("d1-grandpre", "73 09 78 22 29 15 03 88"), "GRANDPRE", "grandpre 页面向量");
eq(dec("d1-grandpre", enc("d1-grandpre", "DCODE")), "DCODE", "grandpre 往返");

eq(enc("d1-rozier", "ROZIER", { key: "DCODE" }), "QAOJDQ", "rozier 向量");
eq(dec("d1-rozier", "QAOJDQ", { key: "DCODE" }), "ROZIER", "rozier 解密");

const tom = ["\\\\/\\", "/\\/", "\\//", "\\\\/\\", "/\\/", "\\//"].join(" ");
eq(enc("d1-tomtom", "TOMTOM"), tom, "tomtom 向量");
eq(dec("d1-tomtom", tom), "TOMTOM", "tomtom 解密");

eq(enc("d1-naknak", "Duck"), "Nak? Nak? Naknaknak nak? Naknak Nanananak Naknak nanak", "naknak Duck 向量");
eq(dec("d1-naknak", "Nak? Nak? Naknaknak nak? Naknak Nanananak Naknak nanak"), "Duck", "naknak 解密");
eq(dec("d1-naknak", enc("d1-naknak", "DCODE")), "DCODE", "naknak 往返");

eq(enc("d1-cadran", "DCODE", { key: "AAAA", disk: "1" }), "04 03 15 04 05", "cadran DCODE 盘1");
eq(dec("d1-cadran", "04 03 15 04 05", { key: "AAAA" }), "DCODE", "cadran 解密");
eq(dec("d1-cadran", "5681158231", { key: "AAAA" }), "DCODE", "cadran 页面向量");
eq(dec("d1-cadran", enc("d1-cadran", "ABCDEFGHIJKLMNOPQRSTUVWXYZ", { key: "AAAA", disk: "2" }), { key: "AAAA" }), "ABCDEFGHIJKLMNOPQRSTUVWXYZ", "cadran 盘2 往返");

const nomMap = "A=Alpha\nB=Bravo\nC=Charlie\nD=Delta\nE=Echo";
eq(enc("d1-nomenclature", "ABC", { map: nomMap }), "Alpha Bravo Charlie", "nomenclature 编码");
eq(dec("d1-nomenclature", "Alpha Bravo Charlie", { map: nomMap }), "ABC", "nomenclature 解密");

eq(dec("d1-tictactoe", enc("d1-tictactoe", "TICTACTOE")), "TICTACTOE", "tictactoe 往返");

eq(enc("d1-scream", "SCREAM"), "ÃA̧ȂÁAǍ", "scream SCREAM 向量");
eq(dec("d1-scream", "ÃA̧ȂÁAǍ"), "SCREAM", "scream 解密");
eq(dec("d1-scream", "A̱A̧ÅA̱Á"), "DCODE", "scream 页面向量");

eq(enc("d1-mac-option", "Option"), "Øπ†ˆø˜", "mac option Option");
eq(dec("d1-mac-option", "Øπ†ˆø˜"), "Option", "mac option 解密");
eq(dec("d1-mac-option", "Âåç"), "Mac", "mac option 页面向量");

eq(dec("d1-modulo", "654 965 561 732 941", { N: "26" }), "DCODE", "modulo 页面向量");
eq(dec("d1-modulo", enc("d1-modulo", "DCODE", { N: "26", k: "100" }), { N: "26" }), "DCODE", "modulo 往返");

console.log(`\nD1 SELFTEST ${fail === 0 ? "PASS" : "FAIL"} ${pass}/${pass + fail} assertions`);
if (fail) {
  console.error(failures.join("\n"));
  process.exit(1);
}
