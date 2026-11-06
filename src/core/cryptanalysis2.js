/*
 * cryptanalysis2.js — 密码分析扩展（cat:'analysis'）。
 *
 * 定位：与 cryptanalysis.js（freqAnalysis/icAnalysis/kasiskiTest/...）正交——
 * 本文件做「自动化恢复」：给密文直接还原密钥 / 明文。不碰 cryptanalysis.js。
 *
 * 覆盖：
 * vigenereAuto 维吉尼亚全自动破解（IC 估阶 + 列卡方恢复密钥 + 解密）
 * hillKnownPlain Hill 已知明文攻击（C·P⁻¹ mod 26 还原密钥矩阵）
 * playfairCrack Playfair 爬山破解（模拟退火 + 四元组适应度）
 *
 * 解密一致性：从 classic.js import vigenereDecode / playfairDecode / parseHillKey /
 * invertMatrixMod，保证恢复结果与项目加密器严丝合缝。
 *
 * 红线：只新建本文件；op id 不与 analysis 现有 op（freqAnalysis/icAnalysis/kasiskiTest/
 * chiSquareAnalysis/subCipherSolver/caesarBrute）冲突。
 */
import { register } from "./registry.js";
import {
  vigenereDecode, playfairDecode, parseHillKey, invertMatrixMod,
} from "./classic.js";
import { solveVigenere } from "./vigenereSolver.js";
import { PLAYFAIR_NGRAM_TABLE } from "./data/quadgramCorpus.js";

const AZ = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const AZ_NO_J = "ABCDEFGHIKLMNOPQRSTUVWXYZ";

// 英文字母频率（A-Z，百分比，用于 Vigenère 卡方）
const ENG_FREQ = [
  8.167, 1.492, 2.782, 4.253, 12.702, 2.228, 2.015, 6.094, 6.966, 0.153,
  0.772, 4.025, 2.406, 6.749, 7.507, 1.929, 0.095, 5.987, 6.327, 9.056,
  2.758, 0.978, 2.360, 0.150, 1.974, 0.074,
];

// ============================================================
// 通用工具
// ============================================================
function cleanLetters(text) {
  return (text || "").toUpperCase().replace(/[^A-Z]/g, "");
}

// mulberry32 — 确定性 PRNG（爬山可复现）
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ============================================================
// Vigenère 全自动
// ============================================================

// 重合指数 IC = Σ f_i(f_i-1) / (N(N-1))
function indexCoincidence(text) {
  const n = text.length;
  if (n < 2) return 0;
  const counts = new Array(26).fill(0);
  for (const ch of text) counts[ch.charCodeAt(0) - 65]++;
  let sum = 0;
  for (const c of counts) sum += c * (c - 1);
  return sum / (n * (n - 1));
}

// 估阶：取平均 IC 最高的长度（真周期及其倍数会峰起），再用 0.9×max 阈值归约到最小周期
function guessKeyLength(ct, maxLen = 20) {
  const scores = [];
  for (let L = 1; L <= maxLen; L++) {
    const cols = [];
    for (let i = 0; i < L; i++) {
      let col = "";
      for (let j = i; j < ct.length; j += L) col += ct[j];
      cols.push(col);
    }
    const avg = cols.reduce((s, c) => s + indexCoincidence(c), 0) / L;
    scores.push({ L, avg });
  }
  let maxAvg = 0;
  for (const s of scores) if (s.avg > maxAvg) maxAvg = s.avg;
 // 候选：avgIC >= 0.9×max 且 L>=2（L=1 是整文 IC，无周期意义），取最小者
  const candidates = scores.filter((s) => s.L >= 2 && s.avg >= 0.9 * maxAvg);
  if (candidates.length === 0) {
    const best = scores.reduce((a, b) => (a.avg > b.avg ? a : b));
    return best;
  }
  candidates.sort((a, b) => a.L - b.L);
  return candidates[0];
}

// 单列卡方：返回最佳移位 0..25
function bestShift(col) {
  const n = col.length;
  const counts = new Array(26).fill(0);
  for (const ch of col) counts[ch.charCodeAt(0) - 65]++;
  let bestS = 0, bestChi = Infinity;
  for (let s = 0; s < 26; s++) {
    let chi = 0;
    for (let i = 0; i < 26; i++) {
      const observed = counts[(i + s) % 26];
      const expected = (ENG_FREQ[i] / 100) * n;
      const d = observed - expected;
      chi += (d * d) / (expected || 0.01);
    }
    if (chi < bestChi) { bestChi = chi; bestS = s; }
  }
  return bestS;
}

function recoverVigenereKey(ct, keyLen) {
  let key = "";
  for (let i = 0; i < keyLen; i++) {
    let col = "";
    for (let j = i; j < ct.length; j += keyLen) col += ct[j];
    key += AZ[bestShift(col)];
  }
  return key;
}

function vigenereAuto(text, p = {}) {
  // guballa.de 算法复刻：逐密钥长度做相邻 bigram 密钥优化 + 全段坐标下降精修，
  // 并把 L=1..max 全部列出；带 { } 数字的 CTF flag 会按字母位置保留包装。
  return solveVigenere(text, p || {});
}

// ============================================================
// Hill 已知明文攻击
// ============================================================

function matMulMod(A, B, m) {
  const n = A.length;
  const C = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      let s = 0;
      for (let k = 0; k < n; k++) s += A[i][k] * B[k][j];
      C[i][j] = ((s % m) + m) % m;
    }
  return C;
}

// 取前 n² 字母，按「每块为列」构造 n×n 矩阵：mat[r][block] = 第 block 块第 r 字母
function lettersToColumnMatrix(text, n) {
  const s = cleanLetters(text);
  if (s.length < n * n) throw new Error(`需要至少 ${n * n} 个字母明文/密文`);
  const mat = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let block = 0; block < n; block++) {
    for (let r = 0; r < n; r++) {
      mat[r][block] = s.charCodeAt(block * n + r) - 65;
    }
  }
  return mat;
}

function hillKnownPlain(text, p = {}) {
  const plain = text;
  const cipher = (p && p.cipher) || "";
  const n = Math.max(2, Math.min(Number(p && p.size) || 2, 4));
  const lines = [];
  lines.push(`=== Hill 已知明文攻击 (${n}×${n}) ===`);
  lines.push("");
  const P = lettersToColumnMatrix(plain, n);
  const C = lettersToColumnMatrix(cipher, n);
  let K;
  try {
    const Pinv = invertMatrixMod(P, 26);
    K = matMulMod(C, Pinv, 26);
  } catch (e) {
    lines.push("✗ 明文矩阵在 mod 26 下不可逆，换一组已知明文（使其行列式与 26 互质）");
    return lines.join("\n");
  }
  const keyNums = [];
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) keyNums.push(K[i][j]);
  const keyStr = keyNums.map((x) => AZ[x]).join("");
  const keyNumStr = keyNums.join(" ");
  lines.push("恢复的密钥矩阵 K（C = K·P mod 26）：");
  for (let i = 0; i < n; i++) {
    lines.push("  " + K[i].map((x) => String(x).padStart(2)).join(" "));
  }
  lines.push("");
  lines.push(`密钥（字母）：${keyStr}`);
  lines.push(`密钥（数字）：${keyNumStr}`);
  lines.push("");
  lines.push("--- 验证 ---");
  const sP = cleanLetters(plain).slice(0, n * n);
  const sC = cleanLetters(cipher).slice(0, n * n);
  let verify = "";
  const pNums = sP.split("").map((c) => c.charCodeAt(0) - 65);
  for (let i = 0; i < n * n; i += n) {
    const vec = pNums.slice(i, i + n);
    for (let r = 0; r < n; r++) {
      let sum = 0;
      for (let c = 0; c < n; c++) sum += K[r][c] * vec[c];
      verify += AZ[((sum % 26) + 26) % 26];
    }
  }
  const ok = verify === sC;
  lines.push(`K·P(前 ${n * n} 字母) = ${verify}`);
  lines.push(`密文前 ${n * n} 字母  = ${sC}`);
  lines.push(ok ? "✓ 验证通过：恢复的密钥正确" : "✗ 验证不一致（明文/密文配对或阶数有误）");
  return lines.join("\n");
}

// ============================================================
// Playfair 爬山破解（模拟退火 + 四元组适应度）
// ============================================================

// 语料：Project Gutenberg 公有领域文本（T623 扩充，quad 覆盖 10.729%）。
// 大表已外置为 ./data/quadgramCorpus.js（约 348KB），本模块仍可整文件惰载；
// n-gram 频率表改为首次使用时解码，避免 Worker 启动时为所有 analysis op 付建表成本。

// N-gram 频率表：quadgram 主信号 + trigram/bigram 回退（解决接近最优时四元组命中稀疏、梯度消失问题）
const _QUAD = new Map();
const _TRI = new Map();
const _BI = new Map();
// 数字键镜像表（26 进制整数编码，值直接存 log2 分）：单表爬山热点路径专用，免字符串分配
const _QUADN = new Map();
const _TRIN = new Map();
const _BIN = new Map();
let _ngramReady = false;
function ensureNgramTables() {
  if (_ngramReady) return;
  const L2 = 1 / Math.log(2);
  const load = (keys, counts, n, strMap, numMap) => {
    const arr = counts.split(".");
    for (let i = 0, off = 0; i < arr.length; i++, off += n) {
      const k = keys.slice(off, off + n);
      const c = parseInt(arr[i], 36);
      strMap.set(k, c);
      let v = 0;
      for (let j = 0; j < n; j++) v = v * 26 + (k.charCodeAt(j) - 65);
      numMap.set(v, Math.log(c + 1) * L2);
    }
  };
  load(PLAYFAIR_NGRAM_TABLE.quadKeys, PLAYFAIR_NGRAM_TABLE.quadCounts, 4, _QUAD, _QUADN);
  load(PLAYFAIR_NGRAM_TABLE.triKeys, PLAYFAIR_NGRAM_TABLE.triCounts, 3, _TRI, _TRIN);
  load(PLAYFAIR_NGRAM_TABLE.biKeys, PLAYFAIR_NGRAM_TABLE.biCounts, 2, _BI, _BIN);
  _ngramReady = true;
}
const _LOG2 = Math.log(2);
// 适应度 = quadgram(主) + 0.3*trigram(辅助) + 0.1*bigram(兜底)
// 三层联合使真值文本 fitness 显著高于局部最优，且近最优区仍有密集梯度
function quadFitness(text) {
  ensureNgramTables();
  const c = cleanLetters(text);
  let score = 0;
  for (let i = 0; i + 4 <= c.length; i++) {
    const q = c.slice(i, i + 4);
    score += Math.log((_QUAD.get(q) || 0) + 1) / _LOG2;
  }
  for (let i = 0; i + 3 <= c.length; i++) {
    const t = c.slice(i, i + 3);
    score += 0.3 * Math.log((_TRI.get(t) || 0) + 1) / _LOG2;
  }
  for (let i = 0; i + 2 <= c.length; i++) {
    const b = c.slice(i, i + 2);
    score += 0.1 * Math.log((_BI.get(b) || 0) + 1) / _LOG2;
  }
  return score;
}

// 用 25 字母方阵解密（与 classic.js playfairDecode 规则一致：完整方阵即 keyword）
function playfairDecryptSquare(ct, square) {
  return playfairDecode(ct, square);
}

function playfairHillClimb(ct, { iterations = 8000, seed = 1, startSquare = null } = {}) {
  const rng = mulberry32(seed);
  let square = (startSquare || AZ_NO_J).split("");
  let bestPlain = playfairDecryptSquare(ct, square.join(""));
  let bestFit = quadFitness(bestPlain);
  let bestSquare = square.slice();
  let curFit = bestFit;
  let curSquare = square.slice();

  for (let it = 0; it < iterations; it++) {
 // 温度：保守策略——温标 ~4→0.3，早期仅允许小幅探索，避免丢失 warm-start 结构；后期纯爬山
    const temp = 0.3 + 3.7 * Math.pow(1 - it / iterations, 1.5);
 // 重入：每 300 次迭代把 cur 拉回 best，防止 SA 长程游走错过最优
    if (it > 0 && it % 300 === 0) {
      curSquare = bestSquare.slice();
      curFit = bestFit;
    }
    const cand = curSquare.slice();
    const move = Math.floor(rng() * 3);
    if (move === 0) {
      const a = Math.floor(rng() * 25), b = Math.floor(rng() * 25);
      [cand[a], cand[b]] = [cand[b], cand[a]];
    } else if (move === 1) {
      const r1 = Math.floor(rng() * 5), r2 = Math.floor(rng() * 5);
      for (let c = 0; c < 5; c++) { const t = cand[r1 * 5 + c]; cand[r1 * 5 + c] = cand[r2 * 5 + c]; cand[r2 * 5 + c] = t; }
    } else {
      const c1 = Math.floor(rng() * 5), c2 = Math.floor(rng() * 5);
      for (let r = 0; r < 5; r++) { const t = cand[r * 5 + c1]; cand[r * 5 + c1] = cand[r * 5 + c2]; cand[r * 5 + c2] = t; }
    }
    const cPlain = playfairDecryptSquare(ct, cand.join(""));
    const cFit = quadFitness(cPlain);
    const dFit = cFit - curFit;
    if (dFit >= 0 || rng() < Math.exp(dFit / temp)) {
      curSquare = cand;
      curFit = cFit;
      if (cFit > bestFit) {
        bestFit = cFit;
        bestSquare = cand.slice();
        bestPlain = cPlain;
      }
    }
  }
  return { square: bestSquare.join(""), plain: bestPlain, fitness: bestFit };
}

// ============================================================
// 通用单表替换爬山内核（subCipherSolver 委托此内核；与 playfairHillClimb 共用
// quadFitness 三层适应度与 mulberry32，对象是 26 字母全置换，支持已知映射锁定。
// 搜索策略用 first-improvement 穷举对序 + 外层多重启——swap 邻域上随机抽对的
// 贪心/SA 实测都会卡「两字母错」局部最优，穷举对序才是文献标准打法）
// ============================================================
function subApplyKey(ct, key) {
 // ct 已是纯大写 A-Z：直接按位查映射，避免逐字符正则（爬山热点路径）
  let out = "";
  for (let i = 0; i < ct.length; i++) out += key[ct.charCodeAt(i) - 65];
  return out;
}

// locked: Map<密文序号 0-25, 明文序号 0-25>，锁定对不参与交换（人工已知线索）
function substitutionHillClimb(ct, { iterations = 10000, seed = 1, startKey = null, locked = null } = {}) {
  ensureNgramTables();
  const rng = mulberry32(seed);
  const start = Array.isArray(startKey) ? startKey.slice() : (startKey || AZ).split("");
  const isLocked = new Array(26).fill(false);
 // 防御式落位：无论起点给什么，锁定位强制为已知明文（锁定位不参与交换，起点错了就永远错）
  if (locked) for (const [c, pl] of locked) { start[c] = AZ[pl]; isLocked[c] = true; }

 // 可交换的密文字母对（排除锁定项，避免白耗评估预算）
  const free = [];
  for (let i = 0; i < 26; i++) if (!isLocked[i]) free.push(i);
  if (free.length < 2) {
    const plain0 = subApplyKey(ct, start);
    return { key: start.join(""), plain: plain0, fitness: quadFitness(plain0) };
  }
 // 密文转数字流：热点路径在数字空间完成映射查表 + 滑窗打分，零字符串分配
  const ctD = new Uint8Array(ct.length);
  for (let i = 0; i < ct.length; i++) ctD[i] = ct.charCodeAt(i) - 65;
 // 全分 = quad(1) + tri(0.3) + bi(0.1)，与 quadFitness 同语料同权重（缺失记 0 = log2(1)）
  const fitOf = (k) => {
    let score = 0;
    let a = 0, b = 0, c = 0;
    for (let i = 0; i < ctD.length; i++) {
      const p = k[ctD[i]];
      if (i >= 3) score += _QUADN.get(((a * 26 + b) * 26 + c) * 26 + p) || 0;
      if (i >= 2) score += 0.3 * (_TRIN.get((b * 26 + c) * 26 + p) || 0);
      if (i >= 1) score += 0.1 * (_BIN.get(c * 26 + p) || 0);
      a = b; b = c; c = p;
    }
    return score;
  };
 // 一轮：随机序遍历全部可交换对，first-improvement（改善即落座）；整轮无改善即收敛
  const pairCount = free.length * (free.length - 1) / 2;
  const climb = (k0) => {
    let key = k0.slice();
    let fit = fitOf(key);
    for (;;) {
      const order = [];
      for (let i = 0; i < free.length; i++) for (let j = i + 1; j < free.length; j++) order.push([free[i], free[j]]);
      for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); const t = order[i]; order[i] = order[j]; order[j] = t; }
      let improved = false;
      for (const [a, b] of order) {
        const cand = key.slice();
        const t = cand[a]; cand[a] = cand[b]; cand[b] = t;
        const cFit = fitOf(cand);
        if (cFit > fit) { key = cand; fit = cFit; improved = true; }
      }
      if (!improved) return { key, fit };
    }
  };
 // ILS：起点爬到收敛 → 从 best 做 2~4 次随机 swap 扰动再爬，直到评估预算耗尽。
 //实测：真解常只距局部最优两次交换（单次 swap 无改善贪心即死），扰动可跨盆地；
 // 随机抽对的贪心与 SA 都会卡「两字母错」局部最优，穷举对序 + 扰动才是文献标准打法。
  const startD = start.map((ch) => ch.charCodeAt(0) - 65);
  let best = climb(startD);
  let evals = pairCount;
  while (evals < iterations) {
    const cand = best.key.slice();
    const nSw = 2 + Math.floor(rng() * 3);
    for (let s = 0; s < nSw; s++) {
      const a = free[Math.floor(rng() * free.length)];
      const b = free[Math.floor(rng() * free.length)];
      const t = cand[a]; cand[a] = cand[b]; cand[b] = t;
    }
    const r = climb(cand);
    evals += pairCount;
    if (r.fit > best.fit) best = r;
  }
  const keyStr = best.key.map((code) => AZ[code]).join("");
  return { key: keyStr, plain: subApplyKey(ct, keyStr), fitness: best.fit };
}

function playfairCrack(text, p = {}) {
  const ct = cleanLetters(text);
  const iterations = Number(p && p.iterations) || 9000;
  const lines = [];
  lines.push("=== Playfair 爬山破解 ===");
  lines.push(`密文长度：${ct.length}（仅字母）`);
  if (ct.length < 40) {
    lines.push("（密文过短，爬山大概率不收敛，需 ≥60 字符）");
  }
  lines.push("");
  const restarts = ct.length >= 60 ? 3 : 1;
  let best = { square: AZ_NO_J, plain: "", fitness: -Infinity };
  const rng = mulberry32(20240708);
  for (let r = 0; r < restarts; r++) {
    let startSquare = AZ_NO_J;
    if (r > 0) {
      const s = AZ_NO_J.split("");
      for (let i = s.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [s[i], s[j]] = [s[j], s[i]]; }
      startSquare = s.join("");
    }
    const res = playfairHillClimb(ct, { iterations, seed: 1 + r * 1000, startSquare });
    if (res.fitness > best.fitness) best = res;
  }
  lines.push(`恢复方阵（25 字母）：${best.square}`);
  lines.push(`适应度：${best.fitness.toFixed(2)}`);
  lines.push("");
  lines.push("--- 解密结果 ---");
  lines.push(best.plain);
  lines.push("");
  lines.push("提示：爬山为概率算法，长密文收敛更稳；方阵等价排列可能不同但解密一致。");
  return lines.join("\n");
}

// ============================================================
// 注册
// ============================================================
register({
  id: "vigenereAuto",
  cat: "analysis",
  name: "维吉尼亚全自动破解",
  desc: "guballa 相邻 bigram 算法：语言画像 + 逐密钥长度全枚举 + 全段精修；支持经典/Beaufort/变体/Autokey、6 种语言、flag 前缀 crib",
  params: [
    { key: "maxKeyLen", label: "最大密钥长度", type: "number", default: 20 },
    { key: "minKeyLen", label: "最小密钥长度", type: "number", default: 1 },
    { key: "keyLen", label: "指定密钥长度（0=全枚举）", type: "number", default: 0 },
    { key: "lang", label: "语言", type: "select", default: "en", options: [
      { value: "en", label: "英语" }, { value: "de", label: "德语" }, { value: "es", label: "西班牙语" },
      { value: "fr", label: "法语" }, { value: "nl", label: "荷兰语" }, { value: "pt", label: "葡萄牙语" },
    ] },
    { key: "variant", label: "变体", type: "select", default: "classic", options: [
      { value: "classic", label: "经典 Vigenère" }, { value: "beaufort", label: "Beaufort" },
      { value: "variant", label: "变体 Beaufort" }, { value: "autokey", label: "Autokey" },
    ] },
    { key: "crib", label: "已知明文前缀 crib（可选，如 flag）", type: "text", default: "" },
    { key: "top", label: "最佳候选条数", type: "number", default: 8 },
  ],
  run: vigenereAuto,
});

register({
  id: "hillKnownPlain",
  cat: "analysis",
  name: "Hill 已知明文攻击",
  desc: "已知明文+密文还原 Hill 密钥矩阵（C·P⁻¹ mod 26，须可逆）",
  params: [
    { key: "cipher", label: "对应密文", type: "text", default: "" },
    { key: "size", label: "矩阵阶 n", type: "number", default: 2 },
  ],
  run: hillKnownPlain,
});

register({
  id: "playfairCrack",
  cat: "analysis",
  name: "Playfair 爬山破解",
  desc: "模拟退火 + 四元组适应度爬山恢复 Playfair 方阵与明文（长密文更稳）",
  params: [{ key: "iterations", label: "迭代次数", type: "number", default: 9000 }],
  run: playfairCrack,
});

export {
  vigenereAuto, hillKnownPlain, playfairCrack,
  indexCoincidence, guessKeyLength, recoverVigenereKey,
  matMulMod, lettersToColumnMatrix,
  quadFitness, playfairDecryptSquare, playfairHillClimb,
  substitutionHillClimb,
};
