import { OPS, COVERAGE, COVERAGE_COUNTS } from "../ops/auto-e2.js";

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
function thrown(fn, label) {
  try { fn(); ok(false, label, "expected throw"); } catch { pass++; }
}

const by = new Map(OPS.map((o) => [o.id, o]));
const run = (id, text, p) => by.get(id).run(text, p || {});

eq(OPS.length, 20, "OPS 数量 = 20");
eq(new Set(OPS.map((o) => o.id)).size, OPS.length, "op id 不重复");
for (const op of OPS) {
  ok(op.id.startsWith("e2-"), `id 前缀 e2- ${op.id}`);
  eq(op.cat, "dcode-extras-2026-10/cat-math", `分类 cat-math ${op.id}`);
  ok(typeof op.run === "function", `run 函数 ${op.id}`);
  ok(Array.isArray(op.params), `params 数组 ${op.id}`);
}

eq(COVERAGE.length, 21, "COVERAGE 条目 = 21");
eq(new Set(COVERAGE.map((c) => c.slug)).size, 20, "唯一 slug = 20（ODE 跨分区重复）");
eq(COVERAGE_COUNTS.implemented, 13, "implemented = 13");
eq(COVERAGE_COUNTS.mapped, 3, "mapped = 3");
eq(COVERAGE_COUNTS.blocked, 5, "blocked = 5");
ok(COVERAGE.every((c) => c.url === `https://www.dcode.fr/${c.slug}`), "URL 与 slug 一致");
ok(COVERAGE.every((c) => ["implemented", "mapped", "blocked"].includes(c.status)), "状态合法");
for (const c of COVERAGE.filter((x) => x.status === "implemented")) ok(by.has(c.target), `implemented 目标存在 ${c.slug} -> ${c.target}`);
for (const c of COVERAGE.filter((x) => x.status !== "implemented")) ok(String(c.reason || "").length > 0, `非 implemented 有 reason ${c.slug}`);
for (const c of COVERAGE.filter((x) => x.status === "blocked")) eq(c.target, "", `blocked 无 target ${c.slug}`);

has(run("e2-taylor", "sin(x)", { n: "7" }), "x - x^3/6 + x^5/120 - x^7/5040", "taylor sin");
has(run("e2-taylor", "exp(x)", { n: "5" }), "1 + x + x^2/2 + x^3/6 + x^4/24 + x^5/120", "taylor exp");
has(run("e2-taylor", "1/(1-x)", { n: "5" }), "1 + x + x^2 + x^3 + x^4 + x^5", "taylor geometric");
has(run("e2-taylor", "log(1+x)", { n: "4" }), "x - x^2/2 + x^3/3 - x^4/4", "taylor log");
has(run("e2-taylor", "sqrt(1+x)", { n: "3" }), "1 + x/2 - x^2/8 + x^3/16", "taylor sqrt");
thrown(() => run("e2-taylor", "sin(1+x)"), "taylor 非零常数项报错");

has(run("e2-invlaplace", "1/(s-1)"), "e^(t)", "invlaplace 1/(s-1)");
has(run("e2-invlaplace", "1/(s^2+1)"), "sin(", "invlaplace 1/(s^2+1)");
const il2 = run("e2-invlaplace", "(s+3)/((s+1)(s+2))");
has(il2, "2*e^(-t)", "invlaplace 部分分式系数 2");
has(il2, "e^(-2t)", "invlaplace 部分分式 e^-2t");
has(run("e2-invlaplace", "1/(s-1)^2"), "t*e^(t)", "invlaplace 重根");
const ilq = run("e2-invlaplace", "s/(s^2+2s+5)");
has(ilq, "cos(2*t)", "invlaplace 共轭二次 cos");
has(ilq, "0.5*sin", "invlaplace 共轭二次 sin 系数");
thrown(() => run("e2-invlaplace", "s^2/(s-1)"), "invlaplace 假分式报错");
thrown(() => run("e2-invlaplace", "1/(s^4+1)"), "invlaplace 高次不可约报错");

const sch = run("e2-schur", "2 1\n1 2");
has(sch, "T =\n1 0\n0 3", "schur 对称矩阵 T=diag(1,3)");
has(sch, "正交误差", "schur 输出正交误差");
has(run("e2-schur", "1 0 0\n0 2 0\n0 0 3"), "T =\n1 0 0\n0 2 0\n0 0 3", "schur 对角矩阵");
const tri = run("e2-trigonal", "0 -1\n1 0");
has(tri, "T =\n-1i 0\n0 1i", "trigonal 旋转矩阵复三角化");
has(tri, "酉误差 = 0", "trigonal 酉误差 0");
has(run("e2-trigonal", "1 1\n0 2"), "T =\n1 1\n0 2", "trigonal 已上三角矩阵");

const her = run("e2-hermite", "3 2 1\n0 1 0\n1 1 1");
has(her, "H =\n1 0 1\n0 1 0\n0 0 2", "hermite dCode 示例 H");
has(her, "U =\n0 -1 1\n0 1 0\n-1 -1 3", "hermite dCode 示例 U");
has(her, "校验通过", "hermite U·M=H 校验");
has(run("e2-hermite", "2 4\n6 8"), "H =\n2 0\n0 4", "hermite 2x2 H");
thrown(() => run("e2-hermite", "1.5 2\n3 4"), "hermite 非整数报错");

has(run("e2-cmatconj", "1+i 2\n3i 4-i"), "1-1i 2\n-3i 4+1i", "cmatconj 逐项共轭");
has(run("e2-cmatconj", "1+i 2\n3i 4-i", { mode: "adjoint" }), "1-1i -3i\n2 4+1i", "cmatconj 共轭转置");
thrown(() => run("e2-cmatconj", "hello"), "cmatconj 非法输入报错");

const wh = run("e2-wheeling", "6 4 3");
has(wh, "覆盖 20 个 3-组合 = 全部", "wheeling 6/4/3 全覆盖");
ok((wh.match(/^\d+(?: \d+){3}$/gm) || []).length >= 1, "wheeling 输出票面");
thrown(() => run("e2-wheeling", "6 3 4"), "wheeling g>k 报错");

has(run("e2-negafib", "12"), "= 1000010", "negafib 12 -> 1000010");
has(run("e2-negafib", "7"), "= 10100", "negafib 7 -> 10100");
has(run("e2-negafib", "-1"), "= 10", "negafib -1 -> 10");
has(run("e2-negafib", "1000010", { mode: "decode" }), "= 12", "negafib decode 1000010");
has(run("e2-negafib", "10100", { mode: "decode" }), "= 7", "negafib decode 10100");
for (let n = -200; n <= 200; n++) {
  const enc = run("e2-negafib", String(n)).split("\n")[0].split("= ").pop();
  const dec = run("e2-negafib", enc, { mode: "decode" }).split("= ").pop();
  eq(dec, String(n), `negafib 往返 ${n}`);
}
thrown(() => run("e2-negafib", "102", { mode: "decode" }), "negafib 非法码报错");

has(run("e2-shapes", "6"), "hexagone", "shapes 6 边形");
has(run("e2-shapes", "6"), "hexaedre", "shapes 6 面体");
has(run("e2-shapes", "12"), "dodecagone", "shapes 12 边形");
has(run("e2-shapes", "12"), "dodecaedre", "shapes 12 面体");
has(run("e2-shapes", "hexagone"), "6 边", "shapes 名称反查");
has(run("e2-shapes", "hexaedre"), "6 面", "shapes 3D 名称反查");
thrown(() => run("e2-shapes", "0"), "shapes 0 报错");

has(run("e2-ode", "y", { x0: "0", y0: "1", x1: "1", steps: "100" }), "2.718281828", "ode y'=y 终点 e");
has(run("e2-ode", "x+y", { x0: "0", y0: "1", x1: "1", steps: "10" }), "3.4365594", "ode y'=x+y 终点");
thrown(() => run("e2-ode", "y+", { x0: "0", y0: "1", x1: "1" }), "ode 非法表达式报错");

function sudokuGrid(out) {
  const lines = out.split("\n");
  const at = lines.findIndex((l) => l.includes("数独解"));
  return lines.slice(at + 1, at + 1 + Number(lines[at].split("×")[0]));
}
function checkLatin(grid, n, regions) {
  const okUnit = (cells) => new Set(cells).size === n && cells.every((v) => v >= 1 && v <= n);
  for (let r = 0; r < n; r++) ok(okUnit(grid[r]), `sudoku 行 ${r}`);
  for (let c = 0; c < n; c++) ok(okUnit(grid.map((row) => row[c])), `sudoku 列 ${c}`);
  if (regions) {
    const byReg = Array.from({ length: n }, () => []);
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) byReg[regions[r][c]].push(grid[r][c]);
    for (const cells of byReg) ok(okUnit(cells), "sudoku 区域");
  }
}
const s4 = run("e2-sudoku-regions", "1...\n...2\n...3\n4...");
const g4 = sudokuGrid(s4).map((line) => [...line].map((ch) => "123456789ABCDEFG".indexOf(ch) + 1));
checkLatin(g4, 4);
has(s4, "回溯节点", "sudoku 输出回溯节点");
const reg5text = "AAABB\nAABBC\nDDBCC\nDDECC\nDEEEE";
const reg5 = [];
const reg5Labels = new Map();
for (const line of reg5text.split("\n")) {
  reg5.push([...line].map((ch) => { if (!reg5Labels.has(ch)) reg5Labels.set(ch, reg5Labels.size); return reg5Labels.get(ch); }));
}
const s5 = run("e2-sudoku-regions", ".....\n.....\n.....\n.....\n.....", { regions: reg5text });
const g5 = sudokuGrid(s5).map((line) => [...line].map((ch) => "123456789ABCDEFG".indexOf(ch) + 1));
checkLatin(g5, 5, reg5);
thrown(() => run("e2-sudoku-regions", ".....\n.....\n.....\n.....\n....."), "sudoku 5x5 缺区域图报错");

const fp0 = run("e2-fillapix", "000\n000\n000");
has(fp0, "...\n...\n...", "fillapix 全 0 -> 全白");
const fp9 = run("e2-fillapix", "464\n696\n464");
has(fp9, "###\n###\n###", "fillapix 全黑盘面线索 -> 全黑");
const pat = ["10000", "01000", "00100", "00010", "00001"];
const clues = [];
for (let r = 0; r < 5; r++) {
  let line = "";
  for (let c = 0; c < 5; c++) {
    let cnt = 0;
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      const rr = r + dr, cc = c + dc;
      if (rr >= 0 && rr < 5 && cc >= 0 && cc < 5 && pat[rr][cc] === "1") cnt++;
    }
    line += String(cnt);
  }
  clues.push(line);
}
const fp = run("e2-fillapix", clues.join("\n"));
const fpLines = fp.split("\n").slice(1, 6);
let fpOk = true;
for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) {
  let cnt = 0;
  for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
    const rr = r + dr, cc = c + dc;
    if (rr >= 0 && rr < 5 && cc >= 0 && cc < 5 && fpLines[rr][cc] === "#") cnt++;
  }
  if (cnt !== Number(clues[r][c])) fpOk = false;
}
ok(fpOk, "fillapix 解满足全部线索");
thrown(() => run("e2-fillapix", "999\n909\n999"), "fillapix 矛盾线索报错");

const ber = run("e2-bernoulli", "10");
has(ber, "B0 = 1", "bernoulli B0");
has(ber, "B1 = 1/2", "bernoulli B1=+1/2");
has(ber, "B2 = 1/6", "bernoulli B2");
has(ber, "B4 = -1/30", "bernoulli B4");
has(ber, "B6 = 1/42", "bernoulli B6");
has(ber, "B10 = 5/66", "bernoulli B10");
thrown(() => run("e2-bernoulli", "81"), "bernoulli 上限报错");

has(run("e2-eulerian", "5"), "1, 26, 66, 26, 1", "eulerian n=5 行");
has(run("e2-eulerian", "5"), "行和 = 120", "eulerian n=5 行和");
has(run("e2-eulerian", "4"), "1, 11, 11, 1", "eulerian n=4 行");

const st = run("e2-stirling1", "5");
has(st, "s(5,k) = 24, -50, 35, -10, 1", "stirling1 n=5 带符号行");
has(st, "|s(5,k)| = 24, 50, 35, 10, 1", "stirling1 n=5 绝对值行");
has(st, "行和 = 120", "stirling1 n=5 行和");
has(run("e2-stirling1", "4"), "s(4,k) = -6, 11, -6, 1", "stirling1 n=4 行");

const ul = run("e2-ulam", "5");
has(ul, "素数个数 = 9", "ulam 5x5 素数计数");
const ulLines = ul.split("\n").filter((l) => /^[#.]+$/.test(l));
eq(ulLines.length, 5, "ulam 5x5 行数");
eq(ulLines.join("").split("").filter((c) => c === "#").length, 9, "ulam 5x5 # 数");
thrown(() => run("e2-ulam", "6"), "ulam 偶数尺寸报错");

has(run("e2-emirp", "1000"), "13, 17, 31, 37, 71, 73, 79, 97, 107, 113", "emirp 前 10 个");
has(run("e2-emirp", "1000"), "36 个", "emirp <=1000 计数");
has(run("e2-emirp", "20"), "13, 17", "emirp <=20");
thrown(() => run("e2-emirp", "1"), "emirp n 下限报错");

const me = run("e2-matrixexp", "1 0\n0 2");
has(me, "2.7182818285 0", "matrixexp diag(1,2) e");
has(me, "0 7.3890560989", "matrixexp diag(1,2) e^2");
has(run("e2-matrixexp", "0 -1\n1 0", { t: "1.5707963267948966" }), "0 -1\n1 0", "matrixexp 旋转 pi/2");
has(run("e2-matrixexp", "1 2\n3 4", { t: "0" }), "1 0\n0 1", "matrixexp t=0 单位阵");
thrown(() => run("e2-matrixexp", "1 2\n3"), "matrixexp 非方阵报错");

const dg = run("e2-graphalgo", "A-B:1\nB-C:2\nA-C:4", { mode: "dijkstra", source: "A", target: "C" });
has(dg, "最短距离 = 3", "graph dijkstra 距离");
has(dg, "A → B → C", "graph dijkstra 路径");
has(run("e2-graphalgo", "A-B:1\nB-C:2\nA-C:4", { mode: "mst" }), "MST 总权重 = 3", "graph MST");
has(run("e2-graphalgo", "A->B\nA->C\nB->D\nC->D", { mode: "topo" }), "拓扑序 = A", "graph 拓扑排序");
has(run("e2-graphalgo", "A-B\nC-D", { mode: "components" }), "连通分量数 = 2", "graph 连通分量");
has(run("e2-graphalgo", "A-B:1\nB-C:2", { mode: "floyd" }), "0 1 3", "graph Floyd 首行");
thrown(() => run("e2-graphalgo", "A-B:1", { mode: "dijkstra", source: "A", target: "Z" }), "graph 未知节点报错");

const qn = run("e2-quaternion", "1+2i+3j+4k");
has(qn, "5.477225575", "quaternion 模");
const qm = run("e2-quaternion", "1+2i+3j+4k", { mode: "mul", q2: "1-i" });
has(qm, "3+1i-1j+7k", "quaternion Hamilton 乘法");
const qi = run("e2-quaternion", "1+2i+3j+4k", { mode: "inverse" });
has(qi, "i", "quaternion 逆输出");
has(run("e2-quaternion", "1+2i+3j+4k", { mode: "conj" }), "1-2i-3j-4k", "quaternion 共轭");
thrown(() => run("e2-quaternion", ""), "quaternion 空输入报错");

console.log(`\nAUTO-E2 SELFTEST ${fail === 0 ? "PASS" : "FAIL"} ${pass}/${pass + fail} assertions`);
if (fail) {
  console.error(failures.join("\n"));
  process.exit(1);
}
