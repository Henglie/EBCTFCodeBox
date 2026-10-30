/*
 * dcode-extras · Agent D3 自测
 * 运行：node addons/dcode-extras-2026-10/tests/auto-d3.selftest.mjs
 *
 * 每个 d3-* op 至少一条已知向量/往返/结构断言；末尾核对 264 条台账的
 * implemented/mapped/blocked 计数与分类分布。
 */

import { OPS, COVERAGE } from "../ops/auto-d3.js";

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
function notHas(out, sub, label) {
  ok(!String(out).includes(sub), label, `unexpected=${JSON.stringify(sub)} out=${String(out).slice(0, 400)}`);
}
function thrown(fn, label) {
  try { fn(); ok(false, label, "expected throw"); }
  catch { pass++; }
}

const by = new Map(OPS.map((o) => [o.id, o]));
const run = (id, text, p) => by.get(id).run(text, p);
const missing = (id) => ok(by.has(id), `op 存在 ${id}`);

// ---------- 模块/台账结构 ----------
eq(OPS.length, 42, "OPS 数量 = 42");
eq(new Set(OPS.map((o) => o.id)).size, OPS.length, "op id 无重复");
for (const op of OPS) {
  ok(op.id.startsWith("d3-"), `id 前缀 d3- (${op.id})`);
  ok(op.cat && op.name && op.desc, `op 元数据完整 (${op.id})`);
  ok(typeof op.run === "function" || (typeof op.encode === "function" && typeof op.decode === "function"), `op 可执行 (${op.id})`);
}

eq(COVERAGE.length, 264, "台账条目 = 264（11 分类）");
const statusCount = { implemented: 0, mapped: 0, blocked: 0 };
for (const e of COVERAGE) {
  ok(e.cat && e.name && e.slug && e.url, `台账字段完整 (${e.cat} / ${e.name})`);
  ok(e.url === `https://www.dcode.fr/${e.slug}`, `台账 URL 由 slug 生成 (${e.slug})`);
  ok(e.status === "implemented" || e.status === "mapped" || e.status === "blocked", `台账状态合法 (${e.name})`);
  statusCount[e.status]++;
  if (e.status === "implemented") ok(by.has(e.op), `implemented op 已注册 (${e.name} → ${e.op})`);
  if (e.status === "mapped") ok(Boolean(e.op), `mapped 有指向 (${e.name})`);
  if (e.status === "blocked") ok(Boolean(e.reason), `blocked 有原因 (${e.name})`);
  ok(!String(e.reason || "").includes("台账缺失"), `台账无内部缺口 (${e.name})`);
}
eq(statusCount.implemented, 127, "台账 implemented = 127");
eq(statusCount.mapped, 96, "台账 mapped = 96");
eq(statusCount.blocked, 41, "台账 blocked = 41");
eq(statusCount.implemented + statusCount.mapped + statusCount.blocked, 264, "台账计数合计 = 264");

const CAT_EXPECT = {
  "Jeux de Société": [11, 10, 1],
  "Jeux sur Mobile": [6, 5, 2],
  "Jeux de Lettres": [45, 16, 8],
  "Jeux de Nombres": [15, 18, 7],
  "Recherche de Mots": [9, 5, 1],
  "Internet": [3, 8, 1],
  "Télécommunication": [1, 9, 1],
  "Traitement de Texte": [4, 3, 0],
  "Fun/Divers": [24, 19, 16],
  "Date et Temps": [8, 2, 0],
  "Musique": [1, 1, 4],
};
for (const [cat, want] of Object.entries(CAT_EXPECT)) {
  const rows = COVERAGE.filter((e) => e.cat === cat);
  const got = [
    rows.filter((e) => e.status === "implemented").length,
    rows.filter((e) => e.status === "mapped").length,
    rows.filter((e) => e.status === "blocked").length,
  ];
  eq(got.join("/"), want.join("/"), `分类计数 ${cat}`);
}
eq(new Set(COVERAGE.map((e) => `${e.cat}\t${e.name}`)).size, COVERAGE.length, "分类内名称无重复");

// ---------- 1 Boggle ----------
missing("d3-boggle");
const boggle = run("d3-boggle", "CAT\nARE\nTEN\n===\ncat\ncare\nten\ndog");
has(boggle, "care (4)", "boggle care");
has(boggle, "cat (3)", "boggle cat");
has(boggle, "ten (3)", "boggle ten");
notHas(boggle, "dog (", "boggle excludes dog");
thrown(() => run("d3-boggle", "A\nB"), "boggle invalid grid throws");

// ---------- 2 字母架找词 ----------
missing("d3-wordfind");
const wf = run("d3-wordfind", "listen\n4,6\n===\nin\nlist\nlisten\nsilent\nten\nnet\nset\nsit\nline\nlens\ntile\nisle");
has(wf, "listen", "wordfind listen");
has(wf, "silent", "wordfind silent");
has(wf, "line", "wordfind line");
ok(!/(^|\s)in(\s|$)/.test(wf), "wordfind excludes 2-letter in", wf);
notHas(wf, "3 字母", "wordfind excludes wrong length ten");

// ---------- 3 Spelling Bee ----------
missing("d3-spellingbee");
const sb = run("d3-spellingbee", "abcdefg\n===\nface\nfade\ncafe\nbead\ndead\nabcdefg\nbed");
has(sb, "face", "spellingbee face");
has(sb, "abcdefg\t【全字母】", "spellingbee pangram");
has(sb, "全字母", "spellingbee pangram marker");
notHas(sb, "bed", "spellingbee excludes no-center bed");

// ---------- 4 Letter Boxed ----------
missing("d3-letterboxed");
const lb = run("d3-letterboxed", "ab cd ef gh\n===\nacegb\nbhdf\naceg");
has(lb, "acegb → bhdf", "letterboxed chain");
has(lb, "覆盖 8/8 字母", "letterboxed coverage");

// ---------- 5 字母增删改 ----------
missing("d3-wordextend");
const wkList = "cat\ncats\ncoat\nscat\nat\ncut\ncart\nact";
const weAdd = run("d3-wordextend", `cat\n===\n${wkList}`, { mode: "add" });
has(weAdd, "cats", "wordextend add cats");
has(weAdd, "coat", "wordextend add coat");
has(weAdd, "scat", "wordextend add scat");
has(weAdd, "cart", "wordextend add cart");
const weDel = run("d3-wordextend", `cart\n===\n${wkList}`, { mode: "remove" });
has(weDel, "cat", "wordextend remove cat");
const weChg = run("d3-wordextend", `cat\n===\n${wkList}`, { mode: "change" });
has(weChg, "cut", "wordextend change cut");
const weExt = run("d3-wordextend", `cat\n===\n${wkList}`, { mode: "extend" });
has(weExt, "cats", "wordextend extend cats");
has(weExt, "scat", "wordextend extend scat");

// ---------- 6 Anacyclique ----------
missing("d3-anacyclic");
const an = run("d3-anacyclic", "===\ndog\ngod\nlive\nevil\nrat\ntar\ncat");
has(an, "dog ↔ god", "anacyclic dog/god");
has(an, "evil ↔ live", "anacyclic live/evil");
has(an, "rat ↔ tar", "anacyclic rat/tar");
notHas(an, "cat ↔", "anacyclic excludes palindrome");

// ---------- 7 单词金字塔 ----------
missing("d3-wordpyramid");
const wp = run("d3-wordpyramid", "a\n===\na\nat\ncat\ncart\ncard", { target: "4" });
has(wp, "a → at → cat → cart", "wordpyramid path");
has(run("d3-wordpyramid", "a\n===\nat\ncat\ncart", { target: "4" }), "a → at → cat → cart", "wordpyramid single-letter seed fallback");

// ---------- 8 缺元音/辅音 ----------
missing("d3-missingletters");
const ml = run("d3-missingletters", "ct\n===\ncat\ncot\ncut\ndog\ndig\ndone", { mode: "vowels" });
has(ml, "cat", "missingletters cat");
has(ml, "cot", "missingletters cot");
has(ml, "cut", "missingletters cut");
notHas(ml, "dog", "missingletters excludes dog");
const mc = run("d3-missingletters", "a\n===\ncat\ncot\ncut\ndog\ndig\ndone", { mode: "consonants" });
has(mc, "cat", "missingletters consonants cat");
notHas(mc, "dog", "missingletters consonants excludes dog");

// ---------- 9 词模式/正则 ----------
missing("d3-wordregex");
const wrGlob = run("d3-wordregex", "ca*\n===\ncat\ncoat\ncart\ndog");
has(wrGlob, "cat", "wordregex glob cat");
has(wrGlob, "cart", "wordregex glob cart");
notHas(wrGlob, "coat", "wordregex glob excludes coat");
const wrRe = run("d3-wordregex", "^c.*t$\n===\ncat\ncoat\ncart\ndog", { mode: "regex" });
has(wrRe, "coat", "wordregex regex coat");
notHas(wrRe, "dog", "wordregex regex excludes dog");

// ---------- 10 前词/后词 ----------
missing("d3-wordorder");
const wo = run("d3-wordorder", "banana\n===\napple\nbanana\ncherry");
has(wo, "前一个：apple", "wordorder prev");
has(wo, "后一个：cherry", "wordorder next");
const wo2 = run("d3-wordorder", "blueberry\n===\napple\nbanana\ncherry");
has(wo2, "前一个：banana", "wordorder insertion prev");
has(wo2, "后一个：cherry", "wordorder insertion next");

// ---------- 11 Jotto ----------
missing("d3-jotto");
const jo = run("d3-jotto", "crane:3\n===\ncrane\nbrain\nstore\nplant");
has(jo, "brain", "jotto brain");
notHas(jo, "crane", "jotto excludes exact");
notHas(jo, "store", "jotto excludes store");

// ---------- 12 Motus ----------
missing("d3-motus");
const mo = run("d3-motus", "5 c\ncrane:GYYYY\n===\ncrane\ncaner\ncrate\ntrace");
has(mo, "caner", "motus caner");
notHas(mo, "crane", "motus excludes all-green crane");
notHas(mo, "trace", "motus excludes first-letter trace");

// ---------- 13 短语过滤 ----------
missing("d3-phrasefilter");
const pf = run("d3-phrasefilter", "HELLO W____\n===\nHELLO WORLD\nHELP ME\nHELLO THERE");
has(pf, "hello world", "phrasefilter hello world");
notHas(pf, "help me", "phrasefilter excludes help me");

// ---------- 14 找词网格 ----------
missing("d3-wordsearch");
const ws = run("d3-wordsearch", "CAT\nARE\nTEN\n===\nCAT\nNET\nDOG");
has(ws, "CAT: (1,1) → (1,3)", "wordsearch CAT");
has(ws, "NET: (3,3) → (1,3)", "wordsearch NET");
has(ws, "DOG: 未找到", "wordsearch missing DOG");

// ---------- 15 变位词生成 ----------
missing("d3-anagram-gen");
const ag = run("d3-anagram-gen", "abc");
has(ag, "变位词 6 个", "anagram-gen count");
has(ag, "abc", "anagram-gen abc");
has(ag, "cba", "anagram-gen cba");
const agf = run("d3-anagram-gen", "abc\n===\nbca\ncat");
has(agf, "bca", "anagram-gen filter bca");
notHas(agf, "cba", "anagram-gen filter excludes cba");

// ---------- 16 回文生成 ----------
missing("d3-palindrome-gen");
eq(run("d3-palindrome-gen", "abc"), "abccba", "palindrome char");
eq(run("d3-palindrome-gen", "ab cd", { mode: "word" }), "ab cd cd ab", "palindrome word");

// ---------- 17 随机 ----------
missing("d3-random");
ok(/^[A-Z]{8}$/.test(run("d3-random", "", { mode: "letter", n: "8" })), "random letters format");
ok(/^\d{8}$/.test(run("d3-random", "", { mode: "digits", n: "8" })), "random digits format");
const cards = run("d3-random", "", { mode: "card", n: "5" }).split(" ");
eq(cards.length, 5, "random 5 cards");
eq(new Set(cards).size, 5, "random cards unique");
ok(cards.every((c) => /^(10|[2-9VDRA])[♠♥♦♣]$/.test(c)), "random card format", cards.join(","));
const rw = run("d3-random", "===\nhello\nworld", { mode: "word" });
ok(rw === "hello" || rw === "world", "random word from list", rw);
eq(run("d3-random", "", { mode: "deck" }).split(" ").length, 53, "random deck 52 + header");
const dr = run("d3-random", "===\na\nb\nc", { mode: "draw", n: "2" }).split("\n");
eq(dr.length, 2, "random draw 2");
ok(dr.every((x) => ["a", "b", "c"].includes(x)), "random draw from list");
ok(/^[\p{L}]+\d+$/u.test(run("d3-random", "", { mode: "pseudo" })), "random pseudo format");

// ---------- 17b 扑克牌参考 ----------
missing("d3-card");
const cardList = run("d3-card", "", { mode: "list" });
has(cardList, "Valet de Coeur", "card list Valet de Coeur");
has(cardList, "Lahire", "card list Lahire");
eq(cardList.split("\n").filter((l) => /^[♠♥♦♣] /.test(l)).length, 52, "card list 52 rows");
const cardVH = run("d3-card", "V♥", { mode: "lookup" });
has(cardVH, "Valet de Coeur", "card V♥ name");
has(cardVH, "Lahire", "card V♥ figure");
has(cardVH, "点数=11", "card V♥ value");
has(run("d3-card", "Dame de Pique", { mode: "lookup" }), "Pallas", "card Dame de Pique figure");
has(run("d3-card", "1♠", { mode: "lookup" }), "As de Pique", "card As de Pique");
has(run("d3-card", "Lahire", { mode: "lookup" }), "Valet de Coeur", "card figure reverse lookup");
thrown(() => run("d3-card", "XYZ", { mode: "lookup" }), "card invalid throws");

// ---------- 18 Mastermind ----------
missing("d3-mastermind");
const mm = run("d3-mastermind", "2 RGB\nRG:2,0");
has(mm, "一致候选 1 个", "mastermind count");
has(mm, "RG", "mastermind RG");

// ---------- 19 幻方 ----------
missing("d3-magicsquare");
has(run("d3-magicsquare", "", { n: "3" }), "幻和 15", "magic 3 sum");
has(run("d3-magicsquare", "", { n: "4" }), "幻和 34", "magic 4 sum");
has(run("d3-magicsquare", "", { n: "6" }), "幻和 111", "magic 6 sum");
has(run("d3-magicsquare", "8 1 6\n3 5 7\n4 9 2"), "是幻方", "magic check valid");
has(run("d3-magicsquare", "1 2 3\n4 5 6\n7 8 9"), "不是幻方", "magic check invalid");
thrown(() => run("d3-magicsquare", "", { n: "2" }), "magic n=2 throws");

// ---------- 20 24 点 / Countdown ----------
missing("d3-countdown");
has(run("d3-countdown", "1 2 3 4", { target: "24", mode: "countdown" }), "= 24", "countdown 24");
has(run("d3-countdown", "6 6 6 6", { target: "24", mode: "24" }), "= 24", "countdown 6s");
const at = run("d3-countdown", "1 2 3 4", { mode: "allten" });
has(at, "1 = ", "allten 1");
has(at, "10 = ", "allten 10");

// ---------- 21 广义数独 ----------
missing("d3-sudoku-n");
function makeSudoku(n, bh, bw, charset) {
  return Array.from({ length: n }, (_, r) =>
    Array.from({ length: n }, (_, c) => charset[((r % bh) * bw + Math.floor(r / bh) + c) % n]).join("")
  ).join("\n");
}
has(run("d3-sudoku-n", makeSudoku(16, 4, 4, "123456789ABCDEFG")), "有效：16×16", "sudoku 16 valid");
has(run("d3-sudoku-n", makeSudoku(10, 2, 5, "123456789A")), "有效：10×10", "sudoku 10 valid");
has(run("d3-sudoku-n", makeSudoku(10, 2, 5, "1234567890")), "有效：10×10", "sudoku 10 zero-as-ten valid");
thrown(() => run("d3-sudoku-n", "1_3Z\n_4_2\n2_4_\n_1_3"), "sudoku unknown symbol throws");
has(run("d3-sudoku-n", "1_34\n_4_2\n2_4_\n_1_3"), "1234", "sudoku 4x4 first row");
has(run("d3-sudoku-n", "1123\n3412\n2341\n4123"), "无效", "sudoku conflict invalid");

// ---------- 22 计算器文字 ----------
missing("d3-calcspell");
eq(run("d3-calcspell", "GOOGLE", { table: "beghilos", dir: "encode" }), "376006", "beghilos encode");
eq(run("d3-calcspell", "376006", { table: "beghilos", dir: "decode" }), "GOOGLE", "beghilos decode");
eq(run("d3-calcspell", "ITFT", { table: "ti30", dir: "encode" }), "1777", "ti30 encode");
eq(run("d3-calcspell", "b", { table: "beghilos", dir: "encode" }), "9", "beghilos lowercase b = 9");
has(run("d3-calcspell", "1777", { table: "ti30", dir: "decode" }), "1→I/J", "ti30 decode ambiguity");
thrown(() => run("d3-calcspell", "A", { table: "beghilos", dir: "encode" }), "beghilos rejects A");

// ---------- 23 常数 ----------
missing("d3-constants");
has(run("d3-constants", "", { constant: "pi", digits: "20" }), "3.14159265358979323846", "pi 20");
has(run("d3-constants", "", { constant: "e", digits: "20" }), "2.71828182845904523536", "e 20");
has(run("d3-constants", "", { constant: "phi", digits: "20" }), "1.61803398874989484820", "phi 20");
has(run("d3-constants", "", { constant: "tau", digits: "20" }), "6.28318530717958647692", "tau 20");
has(run("d3-constants", "", { constant: "pi", digits: "50", search: "26535" }), "第 6 位", "pi search");

// ---------- 24 生日悖论 ----------
missing("d3-birthday");
has(run("d3-birthday", "23"), "50.7297", "birthday 23");
has(run("d3-birthday", "22"), "47.5695", "birthday 22");
has(run("d3-birthday", "1"), "0.0000", "birthday 1");

// ---------- 25 星座/生肖 ----------
missing("d3-zodiac");
const z1 = run("d3-zodiac", "2000-01-25");
has(z1, "水瓶座", "zodiac Aquarius");
has(z1, "金龙", "zodiac 2000 metal dragon");
const z2 = run("d3-zodiac", "2024-12-31");
has(z2, "摩羯座", "zodiac Capricorn");
has(z2, "木龙", "zodiac 2024 wood dragon");
has(run("d3-zodiac", "2000-02-20"), "双鱼座", "zodiac Pisces boundary");

// ---------- 26 日期 ----------
missing("d3-date");
has(run("d3-date", "2000-01-01", { mode: "weekday" }), "星期六", "date weekday");
has(run("d3-date", "2024-12-31", { mode: "doy" }), "第 366 天", "date doy");
has(run("d3-date", "2001", { mode: "century" }), "21 世纪（21st century）", "date century");
has(run("d3-date", "2024-01-01\n===\n2024-03-01", { mode: "diff" }), "60 天", "date diff");
has(run("d3-date", "2024-01-31", { mode: "add", months: "1" }), "2024-02-29", "date add month clamp");
has(run("d3-date", "2024-01-01", { mode: "format" }), "Unix 秒", "date format");

// ---------- 27 拉丁日期 ----------
missing("d3-latin-date");
has(run("d3-latin-date", "2024-02-01"), "Kalendis Februariis", "latin Kalends");
has(run("d3-latin-date", "2024-03-31"), "Pridie Kalendas Apriles", "latin pridie Kalends");
has(run("d3-latin-date", "2024-03-03"), "Ante diem quintum Nonas Martias", "latin ante diem Nonas");
has(run("d3-latin-date", "2024-03-15"), "Idibus Martiis", "latin Ides");
has(run("d3-latin-date", "2024-03-14"), "Pridie Idus Martias", "latin pridie Ides");
has(run("d3-latin-date", "2023-02-28"), "Pridie Kalendas Martias", "latin non-leap Feb 28");

// ---------- 28 时间膨胀 ----------
missing("d3-timedilation");
has(run("d3-timedilation", "0.8"), "1.666666667", "timedilation 0.8");
has(run("d3-timedilation", "0.6"), "1.25", "timedilation 0.6");
thrown(() => run("d3-timedilation", "1"), "timedilation beta=1 throws");

// ---------- 29 AMI ----------
missing("d3-ami");
eq(run("d3-ami", "10110"), "+ 0 - + 0", "ami encode");
eq(run("d3-ami", "+ 0 - + 0", { dir: "decode" }), "10110", "ami decode");
eq(run("d3-ami", run("d3-ami", "11001"), { dir: "decode" }), "11001", "ami roundtrip");

// ---------- 30 国际象棋记谱 ----------
missing("d3-chess");
const fen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
has(run("d3-chess", fen, { mode: "fen" }), "r n b q k b n r", "chess fen board");
has(run("d3-chess", fen, { mode: "fen" }), "白方行棋", "chess fen side");
const uci = run("d3-chess", "e2e4 e7e8q", { mode: "uci" });
has(uci, "e2 → e4", "chess uci e2e4");
has(uci, "升变=Q", "chess uci promotion");
const san = run("d3-chess", "Nf3 O-O e4+", { mode: "san" });
has(san, "子力=N", "chess san knight");
has(san, "王翼易位", "chess san castle");
has(san, "将军", "chess san check");
thrown(() => run("d3-chess", "bad fen", { mode: "fen" }), "chess invalid fen throws");

// ---------- 31 MIDI/音名 ----------
missing("d3-midi");
has(run("d3-midi", "A4"), "MIDI 69", "midi A4 number");
has(run("d3-midi", "A4"), "440.000 Hz", "midi A4 freq");
has(run("d3-midi", "60", { mode: "midi" }), "C4", "midi 60 name");
has(run("d3-midi", "do4"), "MIDI 60", "midi solfege do4");
has(run("d3-midi", "C#5"), "MIDI 73", "midi C#5");
const midiHex = "4D546864000000060000000100604D54726B0000000C00903C6460803C0000FF2F00";
const midiFile = run("d3-midi", midiHex, { mode: "file" });
has(midiFile, "C4", "midi file C4");
has(midiFile, "vel=100", "midi file velocity");
has(midiFile, "dur=0.500", "midi file duration");

// ---------- 32 字符类型 ----------
missing("d3-chartype");
const ct = run("d3-chartype", "Aé1 ", { mode: "type" });
has(ct, "U+0041", "chartype codepoint");
has(ct, "Latin", "chartype script");
has(ct, "数字", "chartype digit");
has(ct, "空白", "chartype space");
has(run("d3-chartype", "Aa1 ", { mode: "count" }), "大写字母: 1", "chartype count upper");
has(run("d3-chartype", "Aa1 ", { mode: "count" }), "小写字母: 1", "chartype count lower");
const sp = run("d3-chartype", "A,!", { mode: "special" });
has(sp, ",", "chartype special comma");
has(sp, "!", "chartype special bang");
notHas(sp, "A  U+", "chartype special excludes letter");

// ---------- 33 可读性 ----------
missing("d3-readability");
const rd = run("d3-readability", "The cat sat on the mat.");
has(rd, "单词 6", "readability word count");
has(rd, "Flesch", "readability Flesch label");
has(rd, "116.1", "readability Flesch value");

// ---------- 34 字符串提取 ----------
missing("d3-strings");
const st = run("d3-strings", "xxHELLOxx\u0001WORLD");
has(st, "HELLO", "strings HELLO");
has(st, "WORLD", "strings WORLD");
has(run("d3-strings", "48454c4c4f", { enc: "hex" }), "HELLO", "strings hex HELLO");

// ---------- 35 虚构身份 ----------
missing("d3-fakeid");
const fid = run("d3-fakeid", "", { mode: "identity" });
has(fid, "虚构", "fakeid disclaimer");
has(fid, "姓名：", "fakeid name");
has(fid, "@example.", "fakeid email");
const ps = run("d3-fakeid", "", { mode: "pseudo", n: "3" });
notHas(ps, "姓名：", "fakeid pseudo no identity");

// ---------- 36 密码变体 ----------
missing("d3-passvariants");
const pv = run("d3-passvariants", "password");
has(pv, "P@$$w0rd", "passvariants leet");
has(pv, "PASSWORD", "passvariants upper");
has(pv, "password2026", "passvariants year");

// ---------- 37 同形字 ----------
missing("d3-homoglyph");
const hg = run("d3-homoglyph", "paypal");
has(hg, "а", "homoglyph cyrillic a");
eq(run("d3-homoglyph", hg, { dir: "decode" }), "paypal", "homoglyph roundtrip");

// ---------- 38 迷宫 ----------
missing("d3-maze");
const mz = run("d3-maze", "", { w: "5", h: "4" });
const mzLines = mz.split("\n").slice(1);
eq(mzLines.length, 9, "maze height 2h+1");
ok(mzLines.every((l) => l.length === 11), "maze width 2w+1");
eq(mzLines[1][0], " ", "maze entrance");
eq(mzLines[7][10], " ", "maze exit");
ok(mzLines.every((l) => /^[# ]+$/.test(l)), "maze chars");

// ---------- 39 混成词 ----------
missing("d3-portmanteau");
has(run("d3-portmanteau", "smoke+fog"), "smog", "portmanteau smog");

// ---------- 40 生命游戏 ----------
missing("d3-life");
const life = run("d3-life", "00000\n00000\n01110\n00000\n00000", { gens: "1" });
has(life, "..#..\n..#..\n..#..", "life blinker");
const life0 = run("d3-life", "010\n010\n010", { gens: "0" });
has(life0, ".#.\n.#.\n.#.", "life generation 0");

// ---------- 41 计算填空 ----------
missing("d3-holecalc");
has(run("d3-holecalc", "3 + ? = 7", { mode: "numbers" }), "3 + 4 = 7", "holecalc number");
has(run("d3-holecalc", "8 ? 2 = 4", { mode: "operators" }), "8 / 2 = 4", "holecalc operator");
has(run("d3-holecalc", "3 ? 4 = 7", { mode: "operators" }), "3 + 4 = 7", "holecalc plus");

console.log(`\nAUTO-D3 SELFTEST ${fail === 0 ? "PASS" : "FAIL"} ${pass}/${pass + fail} assertions`);
if (fail) {
  console.error(failures.join("\n"));
  process.exit(1);
}
