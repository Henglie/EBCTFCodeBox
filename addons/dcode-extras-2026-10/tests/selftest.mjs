/*
 * dcode-extras · 自测（node addons/dcode-extras-2026-10/tests/selftest.mjs）
 * 每个新增 op 至少一条已知向量/往返断言；末尾用 mock ctx 跑 index.setup，核对总注册数。
 */

import plugin, { manifest } from "../index.js";
import { OPS as MATH_MORE } from "../ops/mathmore.js";
import { OPS as TEXT_MORE } from "../ops/textmore.js";
import { OPS as NUM_MORE } from "../ops/numeralmore.js";
import { OPS as CIPHER_MORE } from "../ops/ciphermore.js";

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
  ok(String(out).includes(sub), label, `missing=${JSON.stringify(sub)} out=${String(out).slice(0, 300)}`);
}
function thrown(fn, label) {
  try { fn(); ok(false, label, "expected throw"); }
  catch { pass++; }
}

const all = [...MATH_MORE, ...TEXT_MORE, ...NUM_MORE, ...CIPHER_MORE];
const by = new Map(all.map((o) => [o.id, o]));
const run = (id, text, p) => by.get(id).run(text, p);
const enc = (id, text, p) => by.get(id).encode(text, p);
const dec = (id, text, p) => by.get(id).decode(text, p);

eq(all.length, 27, "新增 op 数 = 27");

has(run("dcode-extras-2026-10/math-happy", "19"), "是快乐数", "happy 19");
has(run("dcode-extras-2026-10/math-happy", "1,100"), "7, 10, 13, 19", "happy list");
has(run("dcode-extras-2026-10/math-aliquot", "28"), "完全数", "aliquot perfect");
has(run("dcode-extras-2026-10/math-aliquot", "12"), "过剩数", "aliquot abundant");
has(run("dcode-extras-2026-10/math-aliquot", "8"), "不足数", "aliquot deficient");
has(run("dcode-extras-2026-10/math-amicable", "1300"), "(220, 284)", "amicable 220");
has(run("dcode-extras-2026-10/math-amicable", "1300"), "(1184, 1210)", "amicable 1184");
has(run("dcode-extras-2026-10/math-catalan", "10"), "C(10) = 16796", "catalan C10");
has(run("dcode-extras-2026-10/math-stirling2", "10,5"), "S(10,5) = 42525", "stirling S(10,5)");
has(run("dcode-extras-2026-10/math-stirling2", "5,0"), "S(5,0) = 0", "stirling S(5,0)");
has(run("dcode-extras-2026-10/math-stirling2", "0,0"), "S(0,0) = 1", "stirling S(0,0)");
has(run("dcode-extras-2026-10/math-lucas", "10"), "L(10) = 123", "lucas L10");
has(run("dcode-extras-2026-10/math-josephus", "41,3"), "= 31", "josephus 41,3");
has(run("dcode-extras-2026-10/math-egyptian", "4/13"), "1/4 + 1/18 + 1/468", "egyptian 4/13");
has(run("dcode-extras-2026-10/math-goldbach", "100"), "3 + 97", "goldbach 100");
has(run("dcode-extras-2026-10/math-goldbach", "100"), "6 组", "goldbach count");
has(run("dcode-extras-2026-10/math-twinprimes", "50"), "(3, 5)", "twin 3,5");
has(run("dcode-extras-2026-10/math-twinprimes", "50"), "(41, 43)", "twin 41,43");
has(run("dcode-extras-2026-10/math-persistence", "39"), "乘法持久性 = 3", "persistence 39");
has(run("dcode-extras-2026-10/math-persistence", "277777788888899"), "乘法持久性 = 11", "persistence 11");
has(run("dcode-extras-2026-10/math-pell", "61"), "x = 1766319049", "pell 61 x");
has(run("dcode-extras-2026-10/math-pell", "61"), "y = 226153980", "pell 61 y");
has(run("dcode-extras-2026-10/math-farey", "5"), "0/1, 1/5, 1/4, 1/3, 2/5, 1/2, 3/5, 2/3, 3/4, 4/5, 1/1", "farey 5");
has(run("dcode-extras-2026-10/math-thuemorse", "16"), "0110100110010110", "thue-morse 16");
has(run("dcode-extras-2026-10/math-thuemorse", "", { check: "0110100110010110" }), "是 Thue–Morse 前缀", "thue-morse check");
has(run("dcode-extras-2026-10/math-matrix", "1 2\n3 4"), "行列式 = -2", "matrix det");
has(run("dcode-extras-2026-10/math-matrix", "1 2\n3 4", { mode: "inverse" }), "-2 1\n3/2 -1/2", "matrix inverse");
has(run("dcode-extras-2026-10/math-matrix", "1 2\n2 4", { mode: "rank" }), "秩 = 1", "matrix rank");
has(run("dcode-extras-2026-10/math-tonelli", "10,13"), "6 或 7", "tonelli 10 mod 13");
has(run("dcode-extras-2026-10/math-tonelli", "3,7"), "无解", "tonelli non-residue");

const nw = "dcode-extras-2026-10/txt-numwords-en";
eq(enc(nw, "123456789"), "one hundred twenty-three million four hundred fifty-six thousand seven hundred eighty-nine", "numwords 123456789");
eq(dec(nw, "forty-two"), "42", "numwords decode 42");
eq(dec(nw, enc(nw, "1000000")), "1000000", "numwords roundtrip");
const cs = "dcode-extras-2026-10/txt-casestyle";
eq(run(cs, "hello world example"), "helloWorldExample", "case camel");
eq(run(cs, "helloWorld example", { mode: "snake" }), "hello_world_example", "case snake");
eq(run(cs, "hello world", { mode: "constant" }), "HELLO_WORLD", "case constant");
const pal = "dcode-extras-2026-10/txt-palindrome";
has(run(pal, "A man, a plan, a canal: Panama"), "回文：是", "palindrome yes");
has(run(pal, "The quick brown fox jumps over the lazy dog"), "全字母句：是", "pangram yes");
has(run(pal, "subdermatoglyphic"), "异形词（无重复字母）：是", "isogram yes");
eq(run("dcode-extras-2026-10/txt-wordwrap", "The quick brown fox", { width: 10 }), "The quick\nbrown fox", "wordwrap 10");
const ro = "dcode-extras-2026-10/txt-rovar";
eq(enc(ro, "hello"), "hohelollolo", "rovar encode");
eq(dec(ro, "hohelollolo"), "hello", "rovar decode");
const ub = "dcode-extras-2026-10/txt-ubbi";
eq(enc(ub, "hello"), "hubellubo", "ubbi hello");
eq(enc(ub, "book"), "bubook", "ubbi book");
eq(dec(ub, "hubellubo"), "hello", "ubbi decode");

const gr = "dcode-extras-2026-10/num-greek";
eq(enc(gr, "2024"), "͵βκδ", "greek 2024");
eq(dec(gr, "͵βκδ"), "2024", "greek decode");
eq(enc(gr, "666"), "χξϝ", "greek 666");
const he = "dcode-extras-2026-10/num-hebrew";
eq(enc(he, "5784"), "ה׳תשפ״ד", "hebrew 5784");
eq(dec(he, "ה׳תשפ״ד"), "5784", "hebrew decode");
eq(enc(he, "15"), "ט״ו", "hebrew 15");
eq(enc(he, "16"), "ט״ז", "hebrew 16");
eq(enc(he, "613"), "תרי״ג", "hebrew 613");
const ud = "dcode-extras-2026-10/num-unicodedigits";
eq(enc(ud, "2026", { script: "devanagari" }), "२०२६", "unicodedigits devanagari");
eq(dec(ud, "२०२६", { script: "devanagari" }), "2026", "unicodedigits decode");
eq(enc(ud, "123", { script: "thai" }), "๑๒๓", "unicodedigits thai");
for (const script of ["devanagari", "thai", "tibetan", "fullwidth", "mathBold", "javanese"]) {
  eq(dec(ud, enc(ud, "0123456789", { script }), { script }), "0123456789", `unicodedigits roundtrip ${script}`);
}

const mz = "dcode-extras-2026-10/cipher-myszkowski";
eq(enc(mz, "ATTACKATDAWN", { key: "TOMATO" }), "AATDTKTNACAW", "myszkowski encode");
eq(dec(mz, "AATDTKTNACAW", { key: "TOMATO" }), "ATTACKATDAWN", "myszkowski decode");
eq(dec(mz, enc(mz, "ABCD", { key: "TOMATO" }), { key: "TOMATO" }), "ABCD", "myszkowski partial row roundtrip");
const qg = "dcode-extras-2026-10/cipher-quagmire";
eq(enc(qg, "A", { mode: "I", key1: "CIPHER", key2: "", ind: "A" }), "G", "quagmire I");
eq(enc(qg, "A", { mode: "II", key1: "", key2: "SECRET", ind: "A" }), "S", "quagmire II");
eq(enc(qg, "A", { mode: "III", key1: "CIPHER", key2: "SECRET", ind: "A" }), "B", "quagmire III");
const qc = enc(qg, "ATTACKATDAWN", { mode: "III", key1: "CIPHER", key2: "SECRET", ind: "KEY" });
eq(dec(qg, qc, { mode: "III", key1: "CIPHER", key2: "SECRET", ind: "KEY" }), "ATTACKATDAWN", "quagmire roundtrip");
thrown(() => enc(qg, "A", { mode: "III", key1: "CIPHER", key2: "SECRET", ind: "" }), "quagmire empty indicator throws");

const cats = [], ops = [], msgs = [];
await plugin({ addCategory: (c) => cats.push(c), registerOp: (o) => ops.push(o), addMessages: (m) => msgs.push(m), log: () => {} });
eq(manifest.id, "dcode-extras-2026-10", "manifest id");
eq(ops.length, 408, "index 总注册数 = 408");
eq(cats.length, 6, "分类数 = 6");
ok(msgs[0] && msgs[0].zh && msgs[0].en, "i18n messages");
const ids = new Set(ops.map((o) => o.id));
eq(ids.size, ops.length, "op id 无重复");
for (const op of all) ok(ids.has(op.id), `index 已注册 ${op.id}`);

console.log(`\nSELFTEST ${fail === 0 ? "PASS" : "FAIL"} ${pass}/${pass + fail} assertions`);
if (fail) {
  console.error(failures.join("\n"));
  process.exit(1);
}
