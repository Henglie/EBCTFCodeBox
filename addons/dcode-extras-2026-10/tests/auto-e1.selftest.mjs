import { OPS, COVERAGE, COVERAGE_STATS } from "../ops/auto-e1.js";

let pass = 0;
let fail = 0;
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
function throws(fn, label) {
  try { fn(); ok(false, label, "expected throw"); } catch { pass++; }
}

const NS = "dcode-extras-2026-10/";
const by = new Map(OPS.map((o) => [o.id, o]));
const id = (s) => NS + "e1-" + s;
const enc = (s, t, p) => by.get(id(s)).encode(t, p);
const dec = (s, t, p) => by.get(id(s)).decode(t, p);
const run = (s, t, p) => by.get(id(s)).run(t, p);

eq(OPS.length, 9, "op 总数 = 9");
ok(new Set(OPS.map((o) => o.id)).size === OPS.length, "op id 唯一");
const allowedCats = new Set([NS + "cat-math", NS + "cat-cipher", NS + "cat-text"]);
for (const op of OPS) {
  ok(op.id.startsWith(NS + "e1-"), `op id 以 e1- 开头 ${op.id}`);
  ok(allowedCats.has(op.cat), `op 分类合法 ${op.id}`);
  ok(Array.isArray(op.params), `op params 数组 ${op.id}`);
  ok(typeof op.encode === "function" || typeof op.decode === "function" || typeof op.run === "function", `op 有 encode/decode/run ${op.id}`);
}

eq(COVERAGE.length, 38, "COVERAGE 条目 = 38（37 缺失 + 1 D1 回收）");
eq(COVERAGE_STATS.byStatus.implemented, 9, "implemented = 9");
eq(COVERAGE_STATS.byStatus.mapped, 22, "mapped = 22");
eq(COVERAGE_STATS.byStatus.blocked, 7, "blocked = 7");
eq(COVERAGE_STATS.unique.implemented, 9, "去重 implemented = 9");
eq(COVERAGE_STATS.unique.mapped, 22, "去重 mapped = 22");
eq(COVERAGE_STATS.unique.blocked, 7, "去重 blocked = 7");
eq(COVERAGE_STATS.byCat["Chiffre Poly-Alphabétique"].total, 21, "分类 Poly-Alphabétique = 21");
eq(COVERAGE_STATS.byCat["Géographie"].total, 14, "分类 Géographie = 14");
eq(COVERAGE_STATS.byCat.dCode.total, 2, "分类 dCode = 2");
eq(COVERAGE_STATS.byCat["Substitution par Symboles"].total, 1, "分类 Substitution par Symboles = 1（Webdings 回收）");
eq(COVERAGE_STATS.unique.implemented + COVERAGE_STATS.unique.mapped + COVERAGE_STATS.unique.blocked, 38, "去重总账 = 38");

const slugSet = new Set(COVERAGE.map((e) => e.slug));
eq(slugSet.size, COVERAGE.length, "COVERAGE slug 无重复");
const expectedSlugs = [
  "chiffre-alberti", "chiffre-autoclave", "chiffre-beaufort", "chiffre-bellaso", "chiffre-chaocipher",
  "chiffre-multiplication-vigenere", "chiffre-ragbaby", "chiffre-slidefair", "chiffre-solitaire-schneier",
  "chiffre-variante-beaufort", "chiffre-gronsfeld", "chiffre-hill", "chiffre-phillips", "chiffre-porta",
  "chiffre-tritheme", "chiffre-vernam", "chiffre-vigenere", "chiffre-cesar-progressif", "cylindre-jefferson",
  "chiffre-decalage-mot-cle", "chiffre-machine-enigma",
  "altitude-terre", "azimut", "calcul-coordonnees-geographiques", "coordonnees-antipodales", "coordonnees-utm",
  "coordonnees-what3words", "distance-geographique", "distance-haversine", "departements-francais",
  "coordonnees-geohash", "geocodage", "geolocalisation-coordonnees", "code-open-location", "parcours-boussole",
  "http://www.prise2tete.fr/", "https://fr.wikipedia.org/",
];
const recoveredSlugs = ["police-webdings"];
ok(expectedSlugs.length === 37, "预期缺失 slug 清单 = 37");
for (const s of expectedSlugs) ok(slugSet.has(s), `缺失 slug 已入账 ${s}`);
for (const s of recoveredSlugs) ok(slugSet.has(s), `D1 回收 slug 已入账 ${s}`);
ok([...slugSet].every((s) => expectedSlugs.includes(s) || recoveredSlugs.includes(s)), "COVERAGE 未混入额外 slug");

const opIds = new Set(OPS.map((o) => o.id));
const usedOps = new Set();
for (const e of COVERAGE) {
  ok(typeof e.cat === "string" && e.cat.length > 0, `ledger cat ${e.slug}`);
  ok(typeof e.name === "string" && e.name.length > 0, `ledger name ${e.slug}`);
  ok(typeof e.slug === "string" && e.slug.length > 0, `ledger slug ${e.slug}`);
  ok(typeof e.url === "string" && e.url.startsWith("https://www.dcode.fr/"), `ledger url ${e.slug}`);
  ok(["implemented", "mapped", "blocked"].includes(e.status), `ledger status ${e.slug}`);
  if (e.status === "implemented") {
    ok(opIds.has(e.op), `implemented op 存在 ${e.slug} -> ${e.op}`);
    usedOps.add(e.op);
  } else if (e.status === "mapped") {
    ok(typeof e.target === "string" && e.target.length > 0, `mapped target 非空 ${e.slug}`);
    ok(e.op === e.target, `mapped op 与 target 一致 ${e.slug}`);
  } else {
    ok(typeof e.reason === "string" && e.reason.length > 0, `blocked reason 非空 ${e.slug}`);
  }
}
for (const op of OPS) ok(usedOps.has(op.id), `op 被 ledger 引用 ${op.id}`);

const entry = (slug) => COVERAGE.find((e) => e.slug === slug);
const mappedTo = (slug, target, label) => {
  const e = entry(slug);
  ok(e && e.status === "mapped" && e.target === target, label, e ? `${e.status}/${e.target}` : "missing");
};
const implementedAs = (slug, op, label) => {
  const e = entry(slug);
  ok(e && e.status === "implemented" && e.op === id(op), label, e ? `${e.status}/${e.op}` : "missing");
};
const blockedWhy = (slug, label) => {
  const e = entry(slug);
  ok(e && e.status === "blocked" && typeof e.reason === "string" && e.reason.length > 0, label, e ? `${e.status}/${e.reason}` : "missing");
};

mappedTo("chiffre-alberti", "alberti", "Alberti -> alberti");
mappedTo("chiffre-autoclave", "autokey", "Autoclave -> autokey");
mappedTo("chiffre-beaufort", "beaufort", "Beaufort -> beaufort");
mappedTo("chiffre-bellaso", "bellaso", "Bellaso -> bellaso");
mappedTo("chiffre-chaocipher", "chaocipher", "Chaocipher -> chaocipher");
implementedAs("police-webdings", "webdings", "Police Webdings -> e1-op（D1 回收）");
implementedAs("chiffre-multiplication-vigenere", "mult-vigenere", "Multiplication Vigenère -> e1-op");
mappedTo("chiffre-ragbaby", "ragbaby", "Ragbaby -> ragbaby");
mappedTo("chiffre-slidefair", "slidefair", "Slidefair -> slidefair");
mappedTo("chiffre-solitaire-schneier", "solitaire", "Solitaire -> solitaire");
mappedTo("chiffre-variante-beaufort", "beaufortVariant", "Variante Beaufort -> beaufortVariant");
mappedTo("chiffre-gronsfeld", "gronsfeld", "Gronsfeld -> gronsfeld");
mappedTo("chiffre-hill", "hill", "Hill -> hill");
mappedTo("chiffre-phillips", "phillips", "Phillips -> phillips");
mappedTo("chiffre-porta", "porta", "Porta -> porta");
mappedTo("chiffre-tritheme", "trithemius", "Trithème -> trithemius");
mappedTo("chiffre-vernam", "otp", "Vernam -> otp");
mappedTo("chiffre-vigenere", "vigenere", "Vigenère -> vigenere");
implementedAs("chiffre-cesar-progressif", "cesar-progressif", "César progressif -> e1-op");
mappedTo("cylindre-jefferson", "jefferson", "Jefferson -> jefferson");
mappedTo("chiffre-decalage-mot-cle", "vigenere", "Décalage par Mot Clé -> vigenere");
mappedTo("chiffre-machine-enigma", "enigma", "Enigma -> enigma");
implementedAs("azimut", "azimuth", "Azimut -> e1-op");
implementedAs("calcul-coordonnees-geographiques", "geo-calc", "Calcul coordonnées -> e1-op");
implementedAs("coordonnees-antipodales", "antipodal", "Antipodes -> e1-op");
mappedTo("coordonnees-utm", "geoUtm", "UTM -> geoUtm");
mappedTo("coordonnees-geohash", "geoHash", "Geohash -> geoHash");
mappedTo("code-open-location", "geoPlusCode", "Plus Code -> geoPlusCode");
implementedAs("distance-haversine", "haversine", "Haversine -> e1-op");
implementedAs("departements-francais", "dept-fr", "Départements -> e1-op");
implementedAs("parcours-boussole", "compass-route", "Parcours boussole -> e1-op");
blockedWhy("altitude-terre", "Altitude blocked");
blockedWhy("coordonnees-what3words", "What3Words blocked");
blockedWhy("distance-geographique", "Distance géographique blocked");
blockedWhy("geocodage", "Géocodage blocked");
blockedWhy("geolocalisation-coordonnees", "Géolocalisation blocked");
blockedWhy("http://www.prise2tete.fr/", "Prise2Tete blocked");
blockedWhy("https://fr.wikipedia.org/", "Wikipedia blocked");

eq(enc("mult-vigenere", "4 3 15 4 5", { key: "3 12 5" }), "12 36 75 12 60", "Multiplication Vigenère 已知向量");
eq(dec("mult-vigenere", "12 36 75 12 60", { key: "3 12 5" }), "4 3 15 4 5", "Multiplication Vigenère 解码向量");
eq(enc("mult-vigenere", "4 3 15", { key: "12" }), "48 36 180", "Multiplication Vigenère 单值密钥");
eq(enc("mult-vigenere", "7 11 13 17", { key: "2 3 5" }), "14 33 65 34", "Multiplication Vigenère 密钥循环");
eq(dec("mult-vigenere", enc("mult-vigenere", "7 11 13 17", { key: "2 3 5" }), { key: "2 3 5" }), "7 11 13 17", "Multiplication Vigenère 往返");
throws(() => enc("mult-vigenere", "", { key: "3" }), "Multiplication Vigenère 空消息报错");
throws(() => enc("mult-vigenere", "1 2", { key: "" }), "Multiplication Vigenère 空密钥报错");
throws(() => enc("mult-vigenere", "1 2", { key: "0 1" }), "Multiplication Vigenère 零密钥报错");
throws(() => enc("mult-vigenere", "1 x", { key: "2" }), "Multiplication Vigenère 非整数报错");
throws(() => dec("mult-vigenere", "12 37", { key: "3 12" }), "Multiplication Vigenère 不整除报错");
throws(() => enc("mult-vigenere", "9007199254740991", { key: "2" }), "Multiplication Vigenère 安全整数报错");

eq(enc("cesar-progressif", "AAA", { start: "3", step: "1" }), "DEF", "César progressif AAA→DEF");
eq(enc("cesar-progressif", "AAA", { start: "0", step: "3" }), "ADG", "César progressif start=0,step=3");
eq(enc("cesar-progressif", "AAA"), "BCD", "César progressif 默认 1,2,3");
eq(enc("cesar-progressif", "AAA", { start: "3", step: "-1" }), "DCB", "César progressif 负步长");
eq(enc("cesar-progressif", "AA BB CC", { start: "1", step: "1", mode: "word" }), "BB DD FF", "César progressif 逐词");
eq(enc("cesar-progressif", "AAAAA", { start: "1", step: "1", mode: "nth", n: "2" }), "BBCCD", "César progressif 每 2 字符");
eq(enc("cesar-progressif", "abc", { start: "1", step: "1" }), "bdf", "César progressif 保留小写");
eq(enc("cesar-progressif", "A-A", { start: "1", step: "1" }), "B-C", "César progressif 非字母透传");
eq(dec("cesar-progressif", enc("cesar-progressif", "Hello, World!", { start: "5", step: "2" }), { start: "5", step: "2" }), "Hello, World!", "César progressif 往返");
throws(() => enc("cesar-progressif", "AAA", { mode: "bad" }), "César progressif 模式报错");
throws(() => enc("cesar-progressif", "AAA", { step: "100001" }), "César progressif 步长越界报错");

eq(enc("webdings", "WEB"), "🕨🏜🏘", "Webdings WEB 已知向量");
eq(dec("webdings", "🕨🏜🏘"), "WEB", "Webdings WEB 解码");
eq(enc("webdings", "DINGBAT"), "🏚🏖👁🏛🏘🏗🛳", "Webdings DINGBAT 已知向量");
eq(dec("webdings", "🏚🏖👁🏛🏘🏗🛳"), "DINGBAT", "Webdings DINGBAT 解码");
eq(enc("webdings", "abc"), "✔🚲□", "Webdings 小写映射");
eq(enc("webdings", "0"), "🗕", "Webdings 数字映射");
eq(enc("webdings", "A B"), "🏗 🏘", "Webdings 空格透传");
eq(dec("webdings", enc("webdings", "dCode 2026!"), {}), "dCode 2026!", "Webdings 往返");
eq(dec("webdings", "🕨\uFE0F🏜\uFE0F🏘\uFE0F"), "WEB", "Webdings 去除变体选择符");
const latin1 = Array.from({ length: 224 }, (_, i) => i + 32).filter((c) => c !== 127).map((c) => String.fromCharCode(c)).join("");
eq(dec("webdings", enc("webdings", latin1)), latin1, "Webdings ASCII+Latin-1 全表往返");
eq(new Set(Array.from(enc("webdings", latin1))).size, 223, "Webdings 223 槽符号唯一");
eq(enc("webdings", "é"), "♿", "Webdings Latin-1 é 映射");
eq(dec("webdings", "♿"), "é", "Webdings Latin-1 é 解码");
eq(enc("webdings", "À"), "🖥", "Webdings Latin-1 À 映射");
throws(() => enc("webdings", "\u007F"), "Webdings 127 无槽位报错");
throws(() => enc("webdings", "Ā"), "Webdings 超出 Latin-1 报错");
throws(() => dec("webdings", "A"), "Webdings 未知符号报错");
throws(() => dec("webdings", "🦄"), "Webdings 未映射 emoji 报错");

has(run("azimuth", "0,0; 0,90"), "方位角: 90°", "Azimut 东 = 90°");
has(run("azimuth", "0,0; 0,90"), "罗盘方位: E", "Azimut 东 = E");
has(run("azimuth", "0,0; 0,90"), "后向方位: 270°", "Azimut 后向 = 270°");
has(run("azimuth", "0,0; 45,0"), "方位角: 0°", "Azimut 北 = 0°");
has(run("azimuth", "0,0; 0,-90"), "方位角: 270°", "Azimut 西 = 270°");
has(run("azimuth", "48.8566,2.3522; 51.5074,-0.1278"), "330.021°", "Azimut Paris→London");
throws(() => run("azimuth", "0,0; 0,0"), "Azimut 重合点报错");
throws(() => run("azimuth", "91,0; 0,0"), "Azimut 纬度越界报错");
throws(() => run("azimuth", "0,181; 0,0"), "Azimut 经度越界报错");
throws(() => run("azimuth", "bad"), "Azimut 格式报错");

has(run("geo-calc", "45.678,5.4321; 46.810,5.1015", { mode: "midpoint" }), "中点: 46.244119, 5.268505", "球面中点 dCode 算例");
has(run("geo-calc", "45.678,5.4321; 46.810,5.1015", { mode: "midpoint" }), "距离: 128.414 km", "中点算例距离");
has(run("geo-calc", "0,0", { mode: "destination", bearing: "90", distance: "111.19492664455873" }), "终点: 0, 1", "目的地 0,0 东 1°");
has(run("geo-calc", "0,0", { mode: "destination", bearing: "0", distance: "111.19492664455873" }), "终点: 1, 0", "目的地 0,0 北 1°");
has(run("geo-calc", "0,0", { mode: "destination", bearing: "90", distance: "111.19492664455873" }), "方位角: 90°", "目的地方位角输出");
throws(() => run("geo-calc", "0,0; 1,1", { mode: "bad" }), "geo-calc 模式报错");
throws(() => run("geo-calc", "0,0", { mode: "destination", radius: "0" }), "geo-calc 半径报错");

eq(run("antipodal", "-12.345,67.890").split("\n")[0], "对跖点: 12.345, -112.11", "对跖点 dCode 算例");
eq(run("antipodal", "0,0").split("\n")[0], "对跖点: 0, -180", "对跖点 (0,0)");
eq(run("antipodal", "90,0").split("\n")[0], "对跖点: -90, -180", "对跖点北极");
throws(() => run("antipodal", "0"), "对跖点格式报错");

has(run("haversine", "48.8566,2.3522; 51.5074,-0.1278"), "距离: 343.556 km", "Haversine Paris→London km");
has(run("haversine", "48.8566,2.3522; 51.5074,-0.1278"), "距离: 213.476 mi", "Haversine Paris→London mi");
has(run("haversine", "48.8566,2.3522; 51.5074,-0.1278"), "圆心角: 3.089674°", "Haversine 圆心角");
has(run("haversine", "0,0; 0,180"), "距离: 20015.087 km", "Haversine 半周长");
has(run("haversine", "0,0; 0,180", { radius: "1" }), "距离: 3.142 km", "Haversine 自定义半径");
throws(() => run("haversine", "0,0; 0,180", { radius: "-1" }), "Haversine 半径报错");
throws(() => run("haversine", "0,0"), "Haversine 单点报错");

eq(run("dept-fr", "75"), "75\tParis\tdépartement", "Département 75");
eq(run("dept-fr", "2a"), "2A\tCorse-du-Sud\tdépartement", "Département 2A 小写输入");
eq(run("dept-fr", "Côte-d'Or"), "21\tCôte-d'Or\tdépartement", "Département 名称查询");
eq(run("dept-fr", "cote d or"), "21\tCôte-d'Or\tdépartement", "Département 无重音查询");
eq(run("dept-fr", "Réunion"), "974\tLa Réunion\tdépartement", "Département 别名 Réunion");
eq(run("dept-fr", "976"), "976\tMayotte\tdépartement", "Département 976 Mayotte");
eq(run("dept-fr", "975"), "975\tSaint-Pierre-et-Miquelon\tcollectivité", "Collectivité 975");
const allDepts = run("dept-fr", "*").split("\n");
eq(allDepts.length, 109, "法国省份+集体 109 行");
eq(allDepts.filter((x) => x.endsWith("\tdépartement")).length, 101, "法国省份 101 个");
eq(allDepts.filter((x) => x.endsWith("\tcollectivité")).length, 8, "海外集体 8 个");
throws(() => run("dept-fr", "96"), "Département 96 不存在报错");
throws(() => run("dept-fr", "Atlantide"), "Département 未知名称报错");

has(run("compass-route", "40N-30E-20S-10O"), "简化路径: 20N, 20E", "Boussole 40N-30E-20S-10O");
has(run("compass-route", "40N-30E-20S-10O"), "最终坐标: 20E, 20N", "Boussole 最终坐标");
has(run("compass-route", "40N-30E-20S-10O"), "总步数: 100", "Boussole 总步数");
has(run("compass-route", "40N-30E-20S-10O"), "直线距离: 28.284", "Boussole 直线距离");
has(run("compass-route", "40N-30E-20S-10O"), "方位角: 45°", "Boussole 方位角");
has(run("compass-route", "12 S - 24 E - 4 S - 8 O - 12 S - 8 E - 4 S - 8 E - 16 SO"), "简化路径: 48S, 16E", "Boussole 长路径含 SO");
has(run("compass-route", "12 S - 24 E - 4 S - 8 O - 12 S - 8 E - 4 S - 8 E - 16 SO"), "总步数: 96", "Boussole 长路径步数");
has(run("compass-route", "3NE"), "简化路径: 3N, 3E", "Boussole 对角 NE");
has(run("compass-route", "3NE"), "直线距离: 4.243", "Boussole 对角直线距离");
has(run("compass-route", "10E-10O"), "简化路径: 0（回到起点）", "Boussole 回到起点");
throws(() => run("compass-route", ""), "Boussole 空输入报错");
throws(() => run("compass-route", "abc"), "Boussole 无方向报错");

if (fail) {
  console.error(`SELFTEST FAIL ${fail} failures / ${pass + fail} assertions`);
  for (const f of failures) console.error(" - " + f);
  process.exit(1);
}
console.log(`SELFTEST PASS ${pass}/${pass} assertions | ops=${OPS.length} | coverage 38 (9 implemented / 22 mapped / 7 blocked)`);
