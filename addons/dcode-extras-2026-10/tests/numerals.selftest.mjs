/*
 * numerals.js 自测：14 个记数 op 的已知向量/往返，以及 T757 的 F3/F8/F10 预算边界。
 * 用法：node addons/dcode-extras-2026-10/tests/numerals.selftest.mjs
 */

import { OPS } from "../ops/numerals.js";

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
function throws(fn, re, label) {
  try {
    fn();
    ok(false, label, "expected throw");
  } catch (e) {
    ok(e instanceof Error && (!re || re.test(e.message)), label, `unexpected error: ${e && e.message}`);
  }
}
function roundtrip(id, value, label) {
  const out = enc(id, value);
  const back = dec(id, out);
  eq(back, value, label);
  return back;
}

const NS = "dcode-extras-2026-10/";
const by = new Map(OPS.map((o) => [o.id, o]));
const op = (s) => by.get(NS + "num-" + s);
const enc = (s, t, p) => op(s).encode(t, p);
const dec = (s, t, p) => op(s).decode(t, p);
const run = (s, t, p) => op(s).run(t, p);

eq(OPS.length, 14, "op 数量 = 14");
ok(OPS.every((o) => o.id.startsWith(NS + "num-")), "所有 op id 以 num- 开头");
ok(new Set(OPS.map((o) => o.id)).size === OPS.length, "op id 唯一");

/* ---------- Unicode 直映 ---------- */
eq(enc("dice", "123456"), "⚀⚁⚂⚃⚄⚅", "骰子 1-6 已知向量");
eq(dec("dice", "⚀⚁⚂⚃⚄⚅"), "123456", "骰子解码");
throws(() => enc("dice", "7"), /不在骰面/, "骰子 7 越界报错");

eq(enc("domino", "0001"), "\u{1F031}\u{1F032}", "多米诺 00/01 已知向量");
eq(dec("domino", "\u{1F031}\u{1F032}"), "0001", "多米诺解码");
eq(roundtrip("domino", "061666"), "061666", "多米诺 06/16/66 往返");
throws(() => enc("domino", "07"), /非法/, "多米诺 7 点半非法报错");

eq(enc("bengali", "2026"), "২০২৬", "孟加拉数字 2026");
eq(dec("bengali", "২০২৬"), "2026", "孟加拉数字解码");

has(enc("ogham", "B L"), "ᚁ", "欧甘 B");
eq(dec("ogham", enc("ogham", "B L F")), "B L F", "欧甘往返");

has(enc("tifinagh", "A Z"), "ⴰ", "提非纳 A");
eq(dec("tifinagh", enc("tifinagh", "A Z")), "A Z", "提非纳往返");

/* ---------- F3 / F10：tally 零值与预算 ---------- */
eq(enc("tally", "0"), "0", "F3 tally 0 有明确编码");
eq(dec("tally", "0"), "0", "F3 tally 解码 0");
for (const v of ["0", "1", "4", "5", "10000"]) eq(roundtrip("tally", v), v, `F3 tally ${v} 往返`);
eq(enc("tally", "5"), "||||/", "tally 5 已知向量");
eq(enc("tally", "7"), "||||/ ||", "tally 7 已知向量");
throws(() => dec("tally", ""), /需要计数符/, "tally 空输入可读报错");
throws(() => dec("tally", "0 ||"), /零编码/, "tally 零编码不得与其他组混用");
throws(() => dec("tally", "|||x"), /无法识别/, "tally 非法组报错");
throws(() => enc("tally", "9".repeat(8)), /预算|20,000,000/, "F10 tally 超输出预算可读拒绝");
throws(() => enc("tally", "-1"), /非负整数/, "tally 负数报错");

/* ---------- F8：bibi / shadok / kaktovik 输出预算 ---------- */
eq(enc("bibi", "0"), "BA", "bibi 0 特例");
eq(enc("bibi", "255"), "FOFO", "bibi 255 已知向量");
eq(dec("bibi", "FOFO"), "255", "bibi 解码 255");
eq(roundtrip("bibi", "1" + "0".repeat(24)), "1" + "0".repeat(24), "bibi 1e24 往返");
throws(() => dec("bibi", "AB"), /非法/, "bibi 非法音节报错");
throws(() => enc("bibi", "9".repeat(13000000)), /预算|20,000,000/, "F8 bibi 超输出预算可读拒绝");

eq(enc("shadok", "0"), "GA", "shadok 0 已知向量");
eq(enc("shadok", "5"), "BU BU", "shadok 5 已知向量");
eq(dec("shadok", "GA"), "0", "shadok 解码 0");
eq(roundtrip("shadok", "1" + "0".repeat(12)), "1" + "0".repeat(12), "shadok 1e12 往返");
throws(() => dec("shadok", "XX"), /未知词/, "shadok 未知词报错");
throws(() => enc("shadok", "9".repeat(4000000)), /预算|20,000,000/, "F8 shadok 超输出预算可读拒绝");

eq(enc("kaktovik", "0"), "0 = [X]", "kaktovik 0 已知向量");
eq(enc("kaktovik", "20"), "20 = [/|] [X]", "kaktovik 20 = [1|0]");
eq(dec("kaktovik", "[/|] [X]"), "20", "kaktovik 解码 [1|0]");
eq(dec("kaktovik", "[X]"), "0", "kaktovik 解码 [X]");
eq(roundtrip("kaktovik", "1" + "0".repeat(15)), "1" + "0".repeat(15), "kaktovik 1e15 往返");
throws(() => dec("kaktovik", "[/|||||]"), /笔画超界/, "kaktovik 下笔 >4 报错");
throws(() => enc("kaktovik", "9".repeat(3000000)), /预算|20,000,000/, "F8 kaktovik 超输出预算可读拒绝");

/* ---------- F10：soroban 预算与列数 ---------- */
const soroban12 = enc("soroban", "123456789012");
eq(dec("soroban", soroban12), "123456789012", "soroban 12 位往返");
eq(dec("soroban", enc("soroban", "0")), "0", "soroban 0 往返");
eq(dec("soroban", enc("soroban", "1234567890123")), "1234567890123", "soroban 13 位（旧上限外）往返");
eq(soroban12.split("\n").length, 6, "soroban 输出 6 行");
throws(() => dec("soroban", "无珠列"), /没有珠列行/, "soroban 非图输入报错");
throws(() => dec("soroban", "|\n|"), /缺少珠列/, "soroban 0 列报错");
throws(() => enc("soroban", "9".repeat(840000)), /预算|20,000,000/, "F10 soroban 超输出预算可读拒绝");

const cols = 100001;
const blank = "    ";
const heaven = "|" + Array(cols).fill(blank).join("|") + "|";
const up = "|" + Array(cols).fill(blank).join("|") + "|";
const decoded = dec("soroban", `${heaven}\n${up}`);
ok(decoded.length === cols && /^0+$/.test(decoded), "soroban decode 不再受 10 万列硬上限", `len=${decoded.length}`);

/* ---------- 七段 / 修士 / 法语 / 10 的幂 ---------- */
eq(dec("sevenseg", enc("sevenseg", "2026")), "2026", "七段 2026 往返");
throws(() => enc("sevenseg", "A"), /不是数字/, "七段非数字报错");

has(enc("cistercian", "1234"), "个位(左上)=1", "cistercian 1234 结构式");
eq(dec("cistercian", enc("cistercian", "1234")), "1234", "cistercian 往返");
eq(dec("cistercian", "9999"), "9999", "cistercian 纯数字解码");

eq(enc("frenchwords", "99"), "quatre-vingt-dix-neuf", "法语 99");
eq(enc("frenchwords", "80"), "quatre-vingts", "法语 80");
eq(dec("frenchwords", "quatre-vingt-dix-neuf"), "99", "法语解码 99");
for (const v of ["0", "1", "21", "71", "80", "81", "100", "101", "1001", "2000", "1000000"]) {
  eq(dec("frenchwords", enc("frenchwords", v)), v, `法语 ${v} 往返`);
}

has(run("powers10", "6"), "10^6 = 1000000", "powers10 6");
has(run("powers10", "-3"), "1/1000", "powers10 -3");

console.log(`\nNUMERALS SELFTEST ${fail === 0 ? "PASS" : "FAIL"} ${pass}/${pass + fail} assertions`);
if (fail) {
  console.error(failures.join("\n"));
  process.exit(1);
}
