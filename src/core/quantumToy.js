/*
 * quantumToy.js — 量子算法的 statevector 玩具模拟（教学演示，非生产级）。
 *
 * 两个算法，都只做「小到能手算」的规模：
 *   grover — L. K. Grover, "A fast quantum mechanical algorithm for database search",
 *            STOC 1996, pp. 212-219。H 制备均匀叠加 → oracle 对目标态做相位翻转
 *            → 关于均值的扩散（2|s><s| - I），一轮一轮看命中概率怎么涨。
 *   shor   — P. W. Shor, "Algorithms for quantum computation: discrete logarithms and
 *            factoring", FOCS 1994；期刊版 SIAM J. Comput. 26(5), 1997。
 *            本文件只做顺序查找的「教学切片」：制备 Σ|x>|1> → 模幂置换
 *            U|x,y> = |x, y·a^x mod N> → 测工作寄存器 → 计数寄存器上做 DFT（逆 QFT）
 *            → 测出 k → 连分数展开得周期 r → gcd(a^{r/2}±1, N) 出因子。
 *
 * 为什么只到 N = 15 / 21：statevector 长度是 2^n × N，每加一位计数比特就翻一倍；
 *   N 稍大（例如 35 需要 n ≥ 6 且 r 更大）就需要线路级模拟器与相干模幂，
 *   本玩具直接放弃而不是给个「看起来对」的因子。
 *
 * 模拟的诚实边界：
 *   · 本文件把模幂写成置换矩阵直接作用在状态向量上（O(2^n·N)），
 *     **不是**线路级分解（真实线路要 O(n^3) 门 + 辅助比特做模乘）。
 *   · 测量是确定性的「取概率最大、并列取下标最小」，不是真随机采样；
 *     真实运行会得到不同的 k，需要重复多次。
 *   · 没有噪声、没有退相干、没有纠错。
 *
 * 红线：教学演示，非生产级；纯本地零外发；不取随机字节。
 */

import { register } from "./registry.js";

// ============================================================
// Grover
// ============================================================

/** 理论最优迭代数：k ≈ round(π/(4θ) - 1/2)，θ = asin(1/√N)。
 *  注意不能「在 0..64 里搜 sin²((2k+1)θ) 的最大值」——相位以 π/(2θ) 为周期重复，
 *  往后搜会找到 k=3、9、15 这类周期性更高点（N=16 时 k=15 的 99.96% 比首个最优 k=3 的
 *  96.13% 更高），那不是「最优轮数」。这里用闭式解，并在 k-1/k+1 邻域核对确为局部最大。 */
function optimalGroverIters(N) {
  const theta = Math.asin(1 / Math.sqrt(N));
  const raw = Math.PI / (4 * theta) - 0.5;
  const k = Math.max(0, Math.round(raw));
  const pAt = (i) => Math.sin((2 * i + 1) * theta) ** 2;
  const prob = pAt(k);
  const isLocalMax = prob >= pAt(Math.max(0, k - 1)) && prob >= pAt(k + 1);
  return { k, prob, raw, isLocalMax };
}

function groverRun(n, target, itersRaw) {
  const N = 1 << n;
  if (!Number.isInteger(target) || target < 0 || target >= N) {
    throw new Error("grover 的 target 是目标态下标，必须落在 [0, 2^n) = [0, " + N + ")，收到 " + target);
  }
  const opt = optimalGroverIters(N);
  const approx = Math.ceil((Math.PI / 4) * Math.sqrt(N));

  let iters;
  if (itersRaw == null || String(itersRaw).trim() === "") iters = opt.k;
  else {
    const v = Number(itersRaw);
    if (!Number.isInteger(v) || v < 0 || v > 32) {
      throw new Error("iters 必须是 0~32 的整数（超过最优轮数只会让概率回落），收到 " + itersRaw);
    }
    iters = v;
  }

  const amp = new Float64Array(N).fill(1 / Math.sqrt(N));
  const rows = [];
  const record = (k) => {
    let p = amp[target] * amp[target];
    let maxIdx = 0;
    for (let i = 1; i < N; i++) if (amp[i] * amp[i] > amp[maxIdx] * amp[maxIdx]) maxIdx = i;
    rows.push({ k, prob: p, top: maxIdx, topProb: amp[maxIdx] * amp[maxIdx] });
  };
  record(0);
  for (let k = 1; k <= iters; k++) {
    amp[target] = -amp[target]; // oracle：目标态相位翻转
    let mean = 0;
    for (let i = 0; i < N; i++) mean += amp[i];
    mean /= N;
    for (let i = 0; i < N; i++) amp[i] = 2 * mean - amp[i]; // 扩散：2|s><s| - I
    record(k);
  }

  const L = [];
  L.push("=== Grover 搜索 statevector 模拟（教学演示，非生产级）===");
  L.push("参数：n = " + n + " qubits，N = 2^n = " + N + "，目标态 |" + target + ">，迭代 iters = " + iters);
  L.push("复杂度边界：statevector 长度 " + N + " 个实幅度（Float64，" + (N * 8) + " B）；单轮 O(N) = " + N + " 次运算");
  L.push("理论最优轮数：k_opt = round(π/(4θ) - 1/2) = " + opt.k + "（θ = asin(1/√N)，精确值 " + opt.raw.toFixed(3) +
    "；该轮命中概率 sin²((2k+1)θ) = " + (opt.prob * 100).toFixed(2) + "%）");
  L.push("常用近似 ⌈π/4·√N⌉ = " + approx + "（N 很小时会高估 1 轮；两者差 " + Math.abs(approx - opt.k) + "）");
  L.push("");
  L.push("轮次 | P(命中目标) | 概率最高态 | 其概率");
  for (const r of rows) {
    const mark = r.k === opt.k ? "  ← 理论最优" : "";
    L.push(String(r.k).padStart(4) + " | " + (r.prob * 100).toFixed(4).padStart(10) + "% | |" +
      String(r.top).padStart(String(N - 1).length) + ">      | " + (r.topProb * 100).toFixed(4).padStart(9) + "%" + mark);
  }
  L.push("");

  // 单调性自证：0..k_opt 段应严格上升
  let mono = true;
  for (let i = 1; i <= Math.min(opt.k, iters); i++) {
    if (!(rows[i].prob > rows[i - 1].prob)) { mono = false; break; }
  }
  const finalP = rows[rows.length - 1].prob;
  L.push("── 自证 ──");
  L.push("第 0.." + opt.k + " 轮命中概率单调上升：" + (mono ? "✓" : "✗"));
  L.push("iters = " + iters + " 时命中概率 = " + (finalP * 100).toFixed(4) + "%，经典随机猜测 = " +
    (100 / N).toFixed(4) + "%（加速 " + (finalP * N).toFixed(2) + " 倍）");
  if (iters > opt.k) {
    L.push("注意：iters 已超过最优轮数，概率开始回落（过旋转）——这正是 Grover 必须知道 N 的原因。");
  }
  L.push("");
  L.push("说明：教学演示，非生产级。这里没有噪声/退相干/纠错，N ≤ 32；真实 Grover 的 √N 加速");
  L.push("      对 2^128 量级的密钥搜索仍不可行，且需要可逆的 oracle 线路。");

  return {
    text: L.join("\n"),
    data: { algo: "grover", n, N, target, iters, optimal: opt.k, approx, rows },
  };
}

// ============================================================
// Shor（小整数切片）
// ============================================================

function modPow(b, e, m) {
  let r = 1n;
  let x = BigInt(b) % BigInt(m);
  let k = BigInt(e);
  const M = BigInt(m);
  while (k > 0n) {
    if (k & 1n) r = (r * x) % M;
    x = (x * x) % M;
    k >>= 1n;
  }
  return Number(r);
}

function gcd(a, b) {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y) { const t = x % y; x = y; y = t; }
  return x;
}

/** 连分数展开：k/M 的收敛子序列 [{p,q}]（q 为分母）。 */
function convergents(num, den) {
  const out = [];
  let n0 = num;
  let d0 = den;
  let p0 = 0;
  let q0 = 1;
  let p1 = 1;
  let q1 = 0;
  for (let i = 0; i < 64; i++) {
    if (d0 === 0) break;
    const a = Math.floor(n0 / d0);
    const p2 = a * p1 + p0;
    const q2 = a * q1 + q0;
    out.push({ p: p2, q: q2 });
    p0 = p1; q0 = q1;
    p1 = p2; q1 = q2;
    const r = n0 - a * d0;
    n0 = d0;
    d0 = r;
    if (q2 > 1e9) break;
  }
  return out;
}

/** 朴素 DFT（逆 QFT 的教学版）：O(M²)。 */
function dft(re, im) {
  const M = re.length;
  const outRe = new Float64Array(M);
  const outIm = new Float64Array(M);
  const norm = 1 / Math.sqrt(M);
  for (let k = 0; k < M; k++) {
    let sr = 0;
    let si = 0;
    for (let x = 0; x < M; x++) {
      const ang = (2 * Math.PI * k * x) / M;
      const c = Math.cos(ang);
      const s = Math.sin(ang);
      sr += re[x] * c - im[x] * s;
      si += re[x] * s + im[x] * c;
    }
    outRe[k] = sr * norm;
    outIm[k] = si * norm;
  }
  return [outRe, outIm];
}

function shorRun(N, n) {
  if (N !== 15 && N !== 21) {
    throw new Error("shor 只接受 N = 15 / 21（教学切片：statevector 长度 2^n×N 与周期 r 都要小到手算），收到 " + N);
  }
  const M = 1 << n;
  if (M < N) {
    throw new Error("计数寄存器太小：2^n = " + M + " < N = " + N + "，无法表示模 " + N + " 的置换；N = " + N + " 需要 n ≥ " +
      Math.ceil(Math.log2(N)));
  }
  if (M > 64) {
    throw new Error("计数寄存器上限 2^6 = 64（n ≤ 6），收到 n = " + n + "，statevector 会到 " + (M * N) + " 个复数幅度");
  }

  // 选底数 a：最小的 a ≥ 2 且 gcd(a, N) = 1
  let a = 2;
  while (a < N && gcd(a, N) !== 1) a++;
  if (a >= N) throw new Error("找不到与 N = " + N + " 互素的底数 a（N 必须是合数）");

  // 真实周期（仅用于最后对拍，量子部分不预设它）
  let rTrue = 1;
  let cur = a % N;
  while (cur !== 1) { cur = (cur * a) % N; rTrue++; if (rTrue > N) throw new Error("周期查找失败：a = " + a + " 在模 " + N + " 下无周期"); }

  // ---- 状态向量：|x>|y>，下标 x*N + y ----
  const re = new Float64Array(M * N);
  const amp0 = 1 / Math.sqrt(M);
  for (let x = 0; x < M; x++) re[x * N + 1] = amp0; // 工作寄存器初值 |1>
  const permuted = new Float64Array(M * N);
  for (let x = 0; x < M; x++) {
    const shift = modPow(a, x, N);
    for (let y = 0; y < N; y++) {
      const v = re[x * N + y];
      if (v === 0) continue;
      permuted[x * N + ((y * shift) % N)] += v;
    }
  }

  // ---- 测工作寄存器（确定性：概率最大、并列取最小 y） ----
  const py = new Float64Array(N);
  for (let y = 0; y < N; y++) {
    let s = 0;
    for (let x = 0; x < M; x++) s += permuted[x * N + y] * permuted[x * N + y];
    py[y] = s;
  }
  let y0 = 0;
  for (let y = 1; y < N; y++) if (py[y] > py[y0] + 1e-12) y0 = y;
  const pY0 = py[y0];
  if (!(pY0 > 0)) throw new Error("工作寄存器测量概率全为 0：状态向量构造有误");

  // ---- 坍缩后的计数寄存器（纯态，长度 M） ----
  const cre = new Float64Array(M);
  const cim = new Float64Array(M);
  const norm = 1 / Math.sqrt(pY0);
  for (let x = 0; x < M; x++) cre[x] = permuted[x * N + y0] * norm;

  const comb = [];
  for (let x = 0; x < M; x++) if (cre[x] * cre[x] > 1e-12) comb.push(x);

  // ---- 逆 QFT（DFT）后测量 ----
  const [fre, fim] = dft(cre, cim);
  const pk = new Float64Array(M);
  for (let k = 0; k < M; k++) pk[k] = fre[k] * fre[k] + fim[k] * fim[k];

  // ---- 连分数 → 候选周期 ----
  // 真实 Shor 每次测量只给一个 k，失败就重测。这里按概率降序逐个峰试（等价于重测），
  // 但每次都把「试了哪个 k、为什么不行」写进输出，不静默挑一个能用的结果。
  const order = [];
  for (let k = 1; k < M; k++) if (pk[k] > 1e-9) order.push(k);
  if (!order.length) throw new Error("QFT 后没有可用的非零峰（计数寄存器坍缩异常）");
  order.sort((x, y) => (pk[y] - pk[x]) || (x - y));
  let k0 = order[0];
  let rCand = null;
  let conv = [];
  let tried = 0;
  const rejects = [];
  for (const k of order) {
    tried++;
    const cv = convergents(k, M);
    let found = null;
    for (const c of cv) {
      if (c.q > 1 && c.q < N && modPow(a, c.q, N) === 1) { found = c.q; break; }
    }
    if (found !== null) { k0 = k; rCand = found; conv = cv; break; }
    rejects.push("k=" + k + "(" + (pk[k] * 100).toFixed(1) + "%)→无可用收敛子");
  }
  if (rCand === null) {
    throw new Error(
      "所有测量峰都给不出可用周期（试了 " + tried + " 个： " + rejects.slice(0, 6).join("，") + "）。" +
      "真实 Shor 会重新测量；本玩具不静默返回错误因子"
    );
  }
  if (rCand % 2 !== 0) {
    throw new Error("找到的周期 r = " + rCand + " 是奇数，a^{r/2} 不是整数，本玩具不继续（真实实现会换底数 a 重试）");
  }

  const half = modPow(a, rCand / 2, N);
  const p1 = gcd(half - 1, N);
  const p2 = gcd(half + 1, N);

  const L = [];
  L.push("=== Shor 因数分解 statevector 模拟（教学演示，非生产级）===");
  L.push("N = " + N + "，底数 a = " + a + "（与 N 互素的最小底数）；计数寄存器 n = " + n + " qubits → M = 2^n = " + M);
  L.push("复杂度边界：联合 statevector 长度 = M × N = " + (M * N) + " 个复数幅度（16 B/个 → " +
    ((M * N * 16) / 1024).toFixed(1) + " KiB）；DFT 为 O(M²) = " + (M * M) + "；置换 O(M·N) = " + (M * N));
  L.push("");
  L.push("[1] 制备：计数寄存器 H 后均匀叠加，工作寄存器置 |1> → (1/√M) Σ_x |x>|1>");
  L.push("[2] 模幂置换 U|x,y> = |x, y·a^x mod N>（a^x mod " + N + " 逐 x 展开：" +
    Array.from({ length: Math.min(M, 8) }, (_, x) => modPow(a, x, N)).join(", ") + (M > 8 ? ", …" : "") + "）");
  L.push("[3] 测工作寄存器：y0 = " + y0 + "（概率 " + (pY0 * 100).toFixed(2) + "%，确定性取最大且下标最小）");
  L.push("[4] 计数寄存器坍缩为周期梳：x ∈ {" + comb.slice(0, 12).join(", ") + (comb.length > 12 ? ", …" : "") + "}（共 " + comb.length + " 个）");
  L.push("[5] 逆 QFT 后测量，概率最高的非零峰 k = " + order[0] + "（P = " + (pk[order[0]] * 100).toFixed(2) + "%）");
  const top = [];
  for (let k = 0; k < M; k++) if (pk[k] > 0.02) top.push({ k, p: pk[k] });
  top.sort((x, y) => y.p - x.p);
  L.push("    主要峰：" + top.slice(0, 6).map((t) => "k=" + t.k + "(" + (t.p * 100).toFixed(1) + "%)").join(" "));
  if (k0 !== order[0]) {
    L.push("    首选峰 k=" + order[0] + " 的连分数给不出周期（" + rejects[0] + "），按概率降序换到 k=" + k0 +
      "（共试 " + tried + " 个峰）——等价于真实 Shor 的重新测量");
  }
  L.push("[6] 连分数展开 k/M = " + k0 + "/" + M + " → 收敛子 " +
    conv.filter((c) => c.q > 0 && c.q < N).slice(0, 4).map((c) => c.p + "/" + c.q).join(", "));
  L.push("    取第一个满足 a^q ≡ 1 (mod N) 且 1 < q < N 的分母 → 周期 r = " + rCand + "（真实周期 " + rTrue + "）");
  L.push("[7] r 为偶数：gcd(a^(r/2)-1, N) = gcd(" + (half - 1) + ", " + N + ") = " + p1 +
    "，gcd(a^(r/2)+1, N) = gcd(" + (half + 1) + ", " + N + ") = " + p2);
  L.push("");
  L.push("── 自证 ──");
  const nontrivial = p1 > 1 && p1 < N && p2 > 1 && p2 < N && p1 * p2 === N;
  L.push("因子 " + p1 + " × " + p2 + " = " + (p1 * p2) + (nontrivial ? " == N ✓" : " ≠ N ✗（本次测量未给出可用因子）"));
  if (!nontrivial) {
    throw new Error("因子校验失败：得到 " + p1 + " × " + p2 + " ≠ " + N + "（不返回错误因子）");
  }
  L.push("周期校验：a^r mod N = " + a + "^" + rCand + " mod " + N + " = " + modPow(a, rCand, N) + " ✓");
  L.push("");
  L.push("说明：教学演示，非生产级。这里是「顺序查找的切片」——模幂置换直接作用在状态向量上，");
  L.push("      不是线路级分解；测量是确定性的取最大概率，不是真随机。N 每加一位，statevector 长度翻倍，");
  L.push("      N 稍大（35 以上）即指数爆炸，本 op 因此只接受 15 / 21。");

  return {
    text: L.join("\n"),
    data: {
      algo: "shor", N, n, M, a, y0, combSize: comb.length, comb,
      k: k0, peakProb: pk[k0], r: rCand, rTrue, p: p1, q: p2, stateLen: M * N,
    },
  };
}

// ============================================================
// 主流程
// ============================================================

export function quantumRun(p) {
  const src = p || {};
  const algo = src.algo == null || String(src.algo).trim() === "" ? "grover" : String(src.algo).trim();
  if (algo !== "grover" && algo !== "shor") throw new Error("algo 只接受 grover / shor，收到 " + algo);

  const nRaw = src.n == null || String(src.n).trim() === "" ? 4 : Number(src.n);
  if (!Number.isInteger(nRaw) || nRaw < 2 || nRaw > 5) {
    throw new Error("qubits 数 n 限 2~5（statevector 长度 2^n，n = 5 时已 32 个幅度；再大就不适合手算了），收到 " + src.n);
  }
  const n = nRaw;

  const targetRaw = src.target == null || String(src.target).trim() === "" ? 0 : Number(src.target);
  if (!Number.isInteger(targetRaw)) throw new Error("target 必须是整数，收到 " + src.target);

  if (algo === "grover") return groverRun(n, targetRaw, src.iters);
  return shorRun(targetRaw, n);
}

register({
  id: "quantumToy",
  cat: "modern",
  name: "量子算法玩具（Grover / Shor）",
  desc: "量子算法 statevector 教学模拟：grover 走完整的 H→oracle 相位翻转→扩散演化，逐轮打印命中概率并与理论最优轮数 round(π/(4θ)-1/2) 对拍（常用近似 ⌈π/4·√N⌉ 在小 N 会高估 1 轮）；shor 只做 N=15/21 的顺序查找切片（模幂置换 + DFT + 连分数），输出周期与因子并自证 p×q=N。教学演示，非生产级：n≤5、无噪声/退相干/纠错、模幂直接作用在状态向量上而非线路级分解，N 稍大即指数爆炸",
  params: [
    { key: "algo", label: "算法", type: "select", default: "grover", options: [
      { value: "grover", label: "grover 无序搜索" },
      { value: "shor", label: "shor 因数分解（N=15/21）" },
    ] },
    { key: "n", label: "qubits 数 n（2~5）", type: "number", default: 4 },
    { key: "target", label: "grover：目标态下标 / shor：待分解 N（15|21）", type: "number", default: 5 },
    { key: "iters", label: "迭代轮数（留空 = 理论最优；仅 grover 用）", type: "text", default: "", placeholder: "0~32；超过最优会回落" },
  ],
  run: (_text, p) => quantumRun(p).text,
});

export { optimalGroverIters, convergents, modPow };
