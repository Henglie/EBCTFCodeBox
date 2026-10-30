import { OPS, COVERAGE } from "../ops/auto-d2.js";

let pass = 0, fail = 0;
const failures = [];
function ok(cond, label, detail) {
  if (cond) { pass++; return; }
  fail++; failures.push(`${label}${detail ? ` :: ${detail}` : ""}`);
}
function eq(actual, expected, label) {
  ok(actual === expected, label, `expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`);
}
function has(out, sub, label) {
  ok(String(out).includes(sub), label, `missing=${JSON.stringify(sub)} out=${String(out).slice(0, 300)}`);
}
function thrown(fn, label) {
  try { fn(); ok(false, label, "expected throw"); } catch { pass++; }
}

const by = new Map(OPS.map((o) => [o.id, o]));
const run = (id, text, p) => by.get(id).run(text, p || {});

eq(OPS.length, 51, "OPS 数量 = 51");
for (const op of OPS) {
  ok(op.id.startsWith("d2-"), `id 前缀 ${op.id}`);
  eq(op.cat, "dcode-extras-2026-10/cat-math", `分类 ${op.id}`);
  ok(typeof op.run === "function", `run 函数 ${op.id}`);
}

eq(COVERAGE.length, 329, "COVERAGE 条目 = 329");
const counts = { implemented: 0, mapped: 0, blocked: 0 };
for (const c of COVERAGE) counts[c.status]++;
eq(counts.implemented, 276, "implemented = 276");
eq(counts.mapped, 39, "mapped = 39");
eq(counts.blocked, 14, "blocked = 14");
eq(new Set(COVERAGE.map((c) => c.slug)).size, 303, "唯一 slug = 303");
ok(COVERAGE.every((c) => c.url === `https://www.dcode.fr/${c.slug}`), "每条 URL 与 slug 一致");
ok(COVERAGE.every((c) => ["implemented", "mapped", "blocked"].includes(c.status)), "状态合法");
ok(!COVERAGE.some((c) => c.reason.includes("本批未实现（需 CAS")), "无默认兜底未分诊项");
for (const c of COVERAGE.filter((x) => x.status === "implemented")) ok(by.has(c.target.split(":")[0]), `implemented 目标存在 ${c.target}`);

has(run("d2-bignum", "2", { mode: "add", a: "12345678901234567890", b: "98765432109876543210" }), "111111111011111111100", "bignum add");
has(run("d2-bignum", "2", { mode: "pow", a: "2", b: "10" }), "1024", "bignum pow");
has(run("d2-bignum", "7", { mode: "div", a: "7", b: "2" }), "商 = 3", "bignum quotient");
has(run("d2-bignum", "-1", { mode: "mod", a: "-1", b: "3" }), "= 2", "bignum mod positive");

eq(run("d2-baseconv", "255", { mode: "to", base: "16" }).split("\n").pop(), "FF", "baseconv 255→FF");
eq(run("d2-baseconv", "FF", { mode: "from", base: "16" }).split("\n").pop(), "255", "baseconv FF→255");
eq(run("d2-baseconv", "-5", { mode: "to", base: "-2" }).split("\n").pop(), "1111", "baseconv negabinary");
eq(run("d2-baseconv", "1111", { mode: "from", base: "-2" }).split("\n").pop(), "-5", "baseconv negabinary back");
has(run("d2-baseconv", "-1", { mode: "complement", width: "8" }), "11111111", "baseconv two's complement");

const zc = run("d2-zeckendorf", "100", { mode: "encode" });
has(zc, "1000010100", "zeckendorf encode");
eq(run("d2-zeckendorf", "1000010100", { mode: "decode" }).split("= ").pop() * 1, 100, "zeckendorf decode");
thrown(() => run("d2-zeckendorf", "11", { mode: "decode" }), "zeckendorf 连续 1 报错");

has(run("d2-complex", "3+4i", { mode: "module" }), "= 5", "complex module");
has(run("d2-complex", "3+4i", { mode: "argument" }), "53.1301023542", "complex argument");
has(run("d2-complex", "1+i", { mode: "mul", z2: "1-i" }), "= 2", "complex mul");

has(run("d2-factor-tools", "28", { mode: "divisors" }), "1, 2, 4, 7, 14, 28", "divisors 28");
has(run("d2-factor-tools", "91", { mode: "fermat" }), "= 13 × 7", "fermat 91");
has(run("d2-factor-tools", "50", { mode: "sumsquares" }), "5² + 5²", "sum of squares 50");
has(run("d2-factor-tools", "3", { mode: "multiples", n: "3", limit: "12" }), "3, 6, 9, 12", "multiples of 3");

has(run("d2-modular", "", { mode: "bezout", a: "240", b: "46" }), "= 2", "bezout gcd");
has(run("d2-modular", "", { mode: "inverse", a: "3", m: "11" }), "= 4", "mod inverse");
has(run("d2-modular", "", { mode: "crt", sys: "2,3;3,5;2,7" }), "x ≡ 23", "CRT");
has(run("d2-modular", "", { mode: "dlog", a: "2", b: "8", m: "13" }), "x = 3", "discrete log");
has(run("d2-modular", "", { mode: "dh", m: "23", a: "5", b: "6", c: "15" }), "共享密钥 = 2", "Diffie-Hellman");

has(run("d2-quadratic", "", { a: "1", b: "-3", c: "2" }), "x₁ = 1，x₂ = 2", "quadratic roots");
has(run("d2-quadratic", "", { a: "1", b: "-3", c: "2" }), "Δ = b²−4ac = 1", "quadratic discriminant");
has(run("d2-quadratic", "", { a: "1", b: "-3", c: "2" }), "(x - 1.5)² - 0.25", "quadratic canonical");

has(run("d2-fraction-periodic", "1/7", { mode: "fraction" }), "0.(142857)", "periodic fraction 1/7");
has(run("d2-fraction-periodic", "0.1(6)", { mode: "decimal" }), "= 1/6", "periodic decimal 0.1(6)");
has(run("d2-fraction-periodic", "7/3", { mode: "fraction" }), "带分数：2 1/3", "mixed number 7/3");

has(run("d2-listcalc", "1 2 3 4 5", { mode: "sum" }), "= 15", "list sum");
has(run("d2-listcalc", "1 2 3 4 5", { mode: "product" }), "= 120", "list product");
has(run("d2-listcalc", "", { mode: "subsetsum", nums: "3 34 4 12 5 2", target: "9" }), "{4, 5}", "subset sum");
has(run("d2-listcalc", "", { mode: "coinchange", coins: "1,2,5", amount: "11" }), "最少硬币数 = 3", "coin change min");
has(run("d2-listcalc", "", { mode: "coinchange", coins: "1,2,5", amount: "11" }), "方案数 = 11", "coin change ways");

for (const n of [3, 4, 6, 10]) has(run("d2-magic-square", String(n)), "全部行列对角线通过", `magic square ${n}`);

has(run("d2-cryptarithm", "SEND+MORE=MONEY"), "9567 + 1085 = 10652", "cryptarithm SEND+MORE");
has(run("d2-holecalc", "2?3=5", { mode: "operator" }), "运算符：+", "hole operator");
has(run("d2-holecalc", "2+?=5", { mode: "number" }), "? = 3", "hole number");

has(run("d2-numfmt", "3.14159", { mode: "round", digits: "3" }), "3.142", "round 3 decimals");
has(run("d2-numfmt", "[2,5)", { mode: "interval" }), "2 ≤ x < 5", "interval notation");
has(run("d2-numfmt", "1:25000", { mode: "scale", distance: "4" }), "实际 1 km", "map scale");
has(run("d2-numfmt", "42", { mode: "parity" }), "偶数", "parity even");
has(run("d2-numfmt", "[2,5)", { mode: "interval", value: "[2,5)" }), "区间", "interval output");

has(run("d2-constants", "", { mode: "pi", digits: "20" }), "3.14159265358979323846", "pi 20 digits");
has(run("d2-constants", "", { mode: "e", digits: "20" }), "2.71828182845904523536", "e 20 digits");
has(run("d2-constants", "", { mode: "phi", digits: "20" }), "1.61803398874989484820", "phi 20 digits");
has(run("d2-constants", "", { mode: "tau", digits: "10" }), "6.2831853071", "tau 10 digits");
has(run("d2-constants", "", { mode: "search", query: "14159" }), "第 1 位", "pi digit search");

const s24 = run("d2-solver24", "4 1 8 7");
has(s24, "= 24", "24 game");
ok(/[+\-×÷]/.test(s24), "24 game has operator");

has(run("d2-primes", "97", { mode: "test" }), "是素数", "prime test 97");
has(run("d2-primes", "91", { mode: "test" }), "不是素数", "prime test 91");
has(run("d2-primes", "100", { mode: "count" }), "π(100) = 25", "prime count 100");
has(run("d2-primes", "100", { mode: "next" }), "= 101", "next prime 100");
has(run("d2-primes", "100", { mode: "prev" }), "= 97", "prev prime 100");
has(run("d2-primes", "7", { mode: "nth" }), "= 17", "7th prime");

has(run("d2-numbertheory", "36", { mode: "phi" }), "φ(36) = 12", "Euler phi 36");
has(run("d2-numbertheory", "30", { mode: "mobius" }), "μ(30) = -1", "Mobius 30");
has(run("d2-numbertheory", "28", { mode: "tau" }), "τ(28) = 6", "tau 28");
has(run("d2-numbertheory", "28", { mode: "sigma" }), "σ_1(28) = 56", "sigma 28");
has(run("d2-numbertheory", "8", { mode: "lambda" }), "λ(8) = 2", "Carmichael lambda 8");

has(run("d2-permutations", "", { mode: "count", n: "5", k: "2" }), "A(5,2) = 20", "arrangements count");
has(run("d2-permutations", "ABC", { mode: "list" }), "ABC ACB BAC BCA CAB CBA", "permutation list");
has(run("d2-permutations", "ABC", { mode: "rank", value: "ABC" }), "= 1", "permutation rank");
has(run("d2-permutations", "ABC", { mode: "unrank", value: "2" }), "= ACB", "permutation unrank");
has(run("d2-permutations", "ABCD", { mode: "derangements" }), "（9 个）", "derangement count");
has(run("d2-permutations", "AB", { mode: "withrep", k: "2" }), "AA AB BA BB", "permutations with repetition");

has(run("d2-combinations", "", { mode: "count", n: "5", k: "2" }), "C(5,2) = 10", "combinations count");
has(run("d2-combinations", "ABCDE", { mode: "list", k: "2" }), "AB AC AD AE BC", "combinations list");
has(run("d2-combinations", "12345", { mode: "rank", n: "5", k: "2", value: "13" }), "= 2", "combination rank");
has(run("d2-combinations", "12345", { mode: "unrank", n: "5", k: "2", value: "2" }), "{1,3}", "combination unrank");
has(run("d2-combinations", "", { mode: "partitions", n: "4" }), "（5 个）", "partitions of 4");
has(run("d2-combinations", "", { mode: "cartesian", a: "AB", b: "12" }), "4 个有序对", "cartesian product");

has(run("d2-probability", "", { mode: "birthday", n: "23" }), "0.5072972343", "birthday 23");
has(run("d2-probability", "", { mode: "binomial", n: "10", p: "0.5", k: "5" }), "0.24609375", "binomial n=10 k=5");
has(run("d2-probability", "", { mode: "conditional", pab: "0.2", pb: "0.5" }), "= 0.4", "conditional probability");
has(run("d2-probability", "", { mode: "expectation", values: "1,2,3,4,5,6", probs: "0.1,0.1,0.1,0.1,0.1,0.5" }), "期望 E = 4", "expectation die");

const rr = run("d2-schedule", "A B C D", { mode: "roundrobin" });
has(rr, "共 3 轮 6 场", "round robin count");
has(rr, "第 3 轮", "round robin rounds");
has(run("d2-schedule", "A B C D", { mode: "bracket" }), "第 2 轮", "bracket rounds");

const rnd1 = run("d2-random", "", { mode: "numbers", count: "5", min: "1", max: "49", seed: "12345" });
const rnd2 = run("d2-random", "", { mode: "numbers", count: "5", min: "1", max: "49", seed: "12345" });
eq(rnd1, rnd2, "random seeded reproducible");
has(run("d2-random", "", { mode: "draw", count: "3", items: "A B C D" }), "不重复抽签", "random draw");

has(run("d2-matrix", "1 2\n3 4", { mode: "det" }), "-2", "matrix det");
has(run("d2-matrix", "1 2\n3 4", { mode: "inverse" }), "-2 1\n3/2 -1/2", "matrix inverse");
has(run("d2-matrix", "1 2\n2 4", { mode: "rank" }), "秩 = 1", "matrix rank");
has(run("d2-matrix", "1 2\n3 4", { mode: "trace" }), "trace = 5", "matrix trace");
has(run("d2-matrix", "1 2\n3 4", { mode: "transpose" }), "1 3\n2 4", "matrix transpose");
has(run("d2-matrix", "1 2\n3 4", { mode: "charpoly" }), "x^2 - 5x - 2", "matrix charpoly");
has(run("d2-matrix", "1 2\n2 4", { mode: "nullspace" }), "零空间维数 1", "matrix nullspace");
has(run("d2-matrix", "1 2\n3 4", { mode: "lu" }), "校验 P·A = L·U：通过", "matrix LU");
has(run("d2-matrix", "1 0 0", { mode: "cross", m2: "0 0 1" }), "(0, -1, 0)", "matrix cross");
has(run("d2-matrix", "1 2\n3 4", { mode: "permanent" }), "= 10", "matrix permanent");

has(run("d2-eigen", "2 1\n1 2", { mode: "values" }), "1, 3", "eigenvalues");
has(run("d2-eigen", "2 1\n1 2", { mode: "spectral" }), "= 3", "spectral radius");
has(run("d2-eigen", "2 1\n1 2", { mode: "vectors" }), "λ = 1", "eigenvectors");
has(run("d2-eigen", "2 1\n1 2", { mode: "diagonalize" }), "P =", "diagonalization");

has(run("d2-poly", "x^2-3x+2", { mode: "roots" }), "1", "poly roots");
has(run("d2-poly", "x^2-3x+2", { mode: "derivative" }), "2x - 3", "poly derivative");
has(run("d2-poly", "x^2-3x+2", { mode: "integral" }), "(1/3)x^3", "poly integral");
has(run("d2-poly", "x^2-3x+2", { mode: "factor" }), "(x - 2)*(x - 1)", "poly factor");
has(run("d2-poly", "x^3-1", { mode: "div", expr2: "x-1" }), "商：x^2 + x + 1", "poly division");
has(run("d2-poly", "(x+1)^2", { mode: "expand" }), "x^2 + 2x + 1", "poly expand");
has(run("d2-poly", "x^2-3x+2", { mode: "taylor", x: "1" }), "x^2 - 3x + 2", "poly taylor");

has(run("d2-equation", "2x+3=7", { mode: "equation" }), "x = 2", "linear equation");
has(run("d2-equation", "x^2-3x+2=0", { mode: "equation" }), "x₁ = 1，x₂ = 2", "quadratic equation");
has(run("d2-equation", "x^2<4", { mode: "inequality" }), "(-2, 2)", "inequality strict");
has(run("d2-equation", "x^2>=4", { mode: "inequality" }), "(-∞, -2] ∪ [2, +∞)", "inequality non-strict");
has(run("d2-equation", "(x+1)^2=x^2+2x+1", { mode: "equality" }), "恒等式成立", "polynomial identity");
has(run("d2-equation", "sin(x)=0.5", { mode: "trig" }), "0.52359878", "trig equation root");

has(run("d2-boolean", "A&B", { mode: "truth" }), "1 1 | 1", "truth table");
has(run("d2-boolean", "A&B|!C", { mode: "minterms" }), "0, 2, 4, 6, 7", "minterms");
has(run("d2-boolean", "A&(A|B)", { mode: "simplify" }), "化简：A", "boolean simplify");
has(run("d2-boolean", "A&B", { mode: "karnaugh" }), "Karnaugh", "karnaugh map");
has(run("d2-boolean", "A|B", { mode: "dual" }), "A&B", "boolean dual");

has(run("d2-expression", "2+3*4^2"), "= 50", "expression arithmetic");
has(run("d2-expression", "sin(pi/2)"), "= 1", "expression sin");
has(run("d2-expression", "erf(1)"), "0.842700689748", "expression erf");

has(run("d2-integral", "x^2", { mode: "single", a: "0", b: "1" }), "0.3333333333", "integral x^2");
has(run("d2-integral", "x*y", { mode: "double", a: "0", b: "1", c: "0", d: "1" }), "0.25", "double integral");
has(run("d2-integral", "x^2", { mode: "primitive" }), "(1/3)x^3", "polynomial primitive");

has(run("d2-function", "x^2-4", { mode: "roots" }), "-2", "function roots");
has(run("d2-function", "x^2-4", { mode: "derivative", x: "3" }), "≈ 6", "function derivative");
has(run("d2-function", "x^2", { mode: "parity" }), "偶函数", "function parity");
has(run("d2-function", "sin(x)", { mode: "period" }), "6.28318531", "function period");
has(run("d2-function", "sin(x)/x", { mode: "limit", x: "0" }), "双侧极限存在", "function limit");
has(run("d2-function", "x^2", { mode: "tangent", x: "1" }), "y = 2x - 1", "function tangent");
has(run("d2-function", "x^2-4", { mode: "table", a: "-2", b: "2", step: "1" }), "f(-2) = 0", "function table");

has(run("d2-interpolation", "0,1;1,2;2,5", { mode: "poly", x: "3" }), "x^2 + 1", "interpolation poly");
has(run("d2-interpolation", "0,1;1,2;2,5", { mode: "lagrange", x: "3" }), "= 10", "lagrange");
has(run("d2-interpolation", "0,1;1,2;2,5", { mode: "newton", x: "3" }), "= 10", "newton");
has(run("d2-interpolation", "0,1;1,2;2,5", { mode: "neville", x: "3" }), "= 10", "neville");

has(run("d2-line", "", { mode: "slope", x1: "1", y1: "2", x2: "3", y2: "6" }), "= 2", "line slope");
has(run("d2-line", "", { mode: "equation", x1: "1", y1: "2", x2: "3", y2: "6" }), "y = 2x", "line equation");
has(run("d2-line", "", { mode: "intersection", x1: "0", y1: "0", x2: "1", y2: "1", x3: "0", y3: "1", x4: "1", y4: "0" }), "(0.5, 0.5)", "line intersection");

has(run("d2-root", "2"), "1.414213562373", "sqrt 2");
has(run("d2-root", "27", { mode: "cbrt" }), "3", "cbrt 27");
has(run("d2-root", "32", { mode: "nth", n: "5" }), "2", "5th root 32");

has(run("d2-angle", "180", { mode: "deg" }), "3.14159265359 rad", "angle deg→rad");
has(run("d2-angle", "100", { mode: "grad" }), "90°", "angle grad→deg");

has(run("d2-triangle", "", { mode: "sss", vals: "a=3,b=4,c=5" }), "面积=6", "triangle SSS");
has(run("d2-triangle", "", { mode: "sss", vals: "a=3,b=4,c=5" }), "C=90°", "triangle right angle");
has(run("d2-triangle", "", { mode: "sas", vals: "a=3,b=4,c=90" }), "c=5", "triangle SAS");

has(run("d2-pick", "0,0;0,2;2,2;2,0"), "面积 A = 4", "Pick area");
has(run("d2-pick", "0,0;0,2;2,2;2,0"), "内部格点 I = 1", "Pick interior");

has(run("d2-coords", "1,1", { mode: "cart2polar" }), "r = 1.4142135624", "cart2polar r");
has(run("d2-coords", "", { mode: "polar2cart", x: "2", y: "90" }), "x = 0", "polar2cart x");
has(run("d2-coords", "", { mode: "cart2sph", x: "0", y: "0", z: "1" }), "r = 1", "cart2sph r");

has(run("d2-koch", "1", { n: "0" }), "周长 = 3", "koch n=0");
has(run("d2-koch", "1", { n: "1" }), "周长 = 4", "koch n=1");
has(run("d2-koch", "1", { n: "3" }), "极限面积 = 0.692820323", "koch limit area");

has(run("d2-stats", "1 2 2 3 5 8", { mode: "mean" }), "算术平均 = 3.5", "stats mean");
has(run("d2-stats", "1 2 2 3 5 8", { mode: "median" }), "中位数 = 2.5", "stats median");
has(run("d2-stats", "1 2 2 3 5 8", { mode: "mode" }), "众数 = 2", "stats mode");
has(run("d2-stats", "1 2 2 3 5 8", { mode: "variance" }), "总体方差", "stats variance");
has(run("d2-stats", "1 2 3 4", { mode: "geometric" }), "2.2133638394", "stats geometric mean");
has(run("d2-stats", "1 2 4", { mode: "harmonic" }), "1.714285714286", "stats harmonic mean");
has(run("d2-stats", "", { mode: "weighted", nums: "1 2 3", weights: "1 2 3" }), "2.3333333333", "stats weighted mean");
has(run("d2-stats", "1 2 3 4", { mode: "quartiles" }), "Q1 = 1.75", "stats quartiles");

has(run("d2-percent", "", { mode: "percent", part: "25", total: "200" }), "12.5%", "percent");
has(run("d2-percent", "", { mode: "confidence", p: "0.5", n: "100", level: "0.95" }), "0.4020018", "confidence interval");
has(run("d2-percent", "", { mode: "precision", tp: "8", fp: "2", fn: "1" }), "0.8", "precision");
has(run("d2-percent", "", { mode: "precision", tp: "8", fp: "2", fn: "1" }), "0.8888888889", "recall");

has(run("d2-color", "500", { mode: "wavelength" }), "599.584916 THz", "color wavelength frequency");
has(run("d2-color", "#FF0000", { mode: "hex2rgb" }), "RGB = (255, 0, 0)", "hex to rgb");
has(run("d2-color", "16711680", { mode: "int2rgb" }), "RGB = (255, 0, 0)", "int to rgb");
has(run("d2-color", "255,0,0", { mode: "rgb2hex" }), "#FF0000", "rgb to hex");

has(run("d2-atomic", "Fe", { mode: "lookup" }), "原子序数 = 26", "atomic lookup Fe");
has(run("d2-atomic", "26", { mode: "config" }), "[Ar] 3d6 4s2", "electron config Fe");
has(run("d2-atomic", "Cu", { mode: "config" }), "[Ar] 3d10 4s1", "electron config Cu exception");
has(run("d2-atomic", "He", { mode: "encode" }), "2", "atomic encode He");
has(run("d2-atomic", "26-8", { mode: "decode" }), "FeO", "atomic decode FeO");

has(run("d2-radioactivity", "100", { mode: "remaining", half: "10", time: "10" }), "剩余比例 = 50%", "radioactivity half-life");
has(run("d2-radioactivity", "100", { mode: "time", half: "10", target: "25" }), "= 20", "radioactivity time");

has(run("d2-relativity", "0.8"), "γ = 1.6666666667", "relativity gamma");
has(run("d2-relativity", "0.8"), "观测长度 L = 0.6", "relativity length contraction");

has(run("d2-series", "10", { mode: "fibonacci" }), "F(10) = 55", "Fibonacci");
has(run("d2-series", "10", { mode: "lucas" }), "L(10) = 123", "Lucas");
has(run("d2-series", "4", { mode: "harmonic" }), "H_4 = 25/12", "harmonic number");
has(run("d2-series", "415/93", { mode: "cf" }), "[4; 2; 6; 7]", "continued fraction");
has(run("d2-series", "2", { mode: "sqrtcf" }), "[1; (2)]", "sqrt continued fraction");

has(run("d2-graph", "S..#\n.#..\n...E", { mode: "grid" }), "最短路径长度 = 5 步", "grid BFS");
has(run("d2-graph", "", { mode: "pyramid", triangle: "3\n7 4\n2 4 6\n8 5 9 3" }), "最大路径和 = 23", "pyramid path");

has(run("d2-biology", "AUGGCCUUU", { mode: "codon" }), "MAF", "codon translation");
has(run("d2-biology", "M", { mode: "reverse" }), "AUG", "reverse translation");
has(run("d2-biology", "", { mode: "life", grid: ".....\n..#..\n...#.\n.###.\n.....", steps: "1" }), ".#.#.", "game of life");

has(run("d2-plot", "0,0;1,1;2,4"), "<svg", "plot svg");
has(run("d2-plot", "0,0;1,1;2,4"), "<polyline", "plot polyline");

has(run("d2-dft", "1 0 0 0", { mode: "dft" }), "mag=1", "DFT impulse");
has(run("d2-dft", "1,0", { mode: "idft" }), "1", "IDFT n=1");

eq(run("d2-special", "0", { mode: "erf" }).split("= ").pop(), "0", "erf 0");
has(run("d2-special", "1", { mode: "erf" }), "0.842700689748", "erf 1");
has(run("d2-special", "0", { mode: "erfc" }), "= 1", "erfc 0");
has(run("d2-special", "5", { mode: "gamma" }), "= 24", "gamma 5");

has(run("d2-laplace", "exp(-t)", { s: "1", T: "50" }), "0.5000000174", "Laplace numeric");

thrown(() => run("d2-baseconv", "2", { mode: "to", base: "1" }), "base 1 throws");
thrown(() => run("d2-cryptarithm", "A+B=C+D"), "cryptarithm malformed throws");
thrown(() => run("d2-matrix", "1 2\n3 4", { mode: "inverse" }).length && by.get("d2-matrix").run("1 2\n2 4", { mode: "inverse" }), "singular inverse throws");
thrown(() => run("d2-function", "sqrt(x)", { mode: "eval", x: "nan" }), "function NaN throws");

console.log(`\nAUTO-D2 SELFTEST ${fail === 0 ? "PASS" : "FAIL"} ${pass}/${pass + fail} assertions`);
if (fail) {
  console.error(failures.join("\n"));
  process.exit(1);
}
