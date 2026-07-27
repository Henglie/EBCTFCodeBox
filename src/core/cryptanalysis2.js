/*
 * cryptanalysis2.js — 密码分析扩展（T97，cat:'analysis'）。
 *
 * 定位：与 T57 cryptanalysis.js（freqAnalysis/icAnalysis/kasiskiTest/...）正交——
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
  const maxLen = Math.min(Number(p && p.maxKeyLen) || 20, 30);
  const ct = cleanLetters(text);
  const lines = [];
  lines.push("=== 维吉尼亚全自动破解 ===");
  lines.push(`密文长度：${ct.length}（仅字母）`);
  if (ct.length < 20) {
    lines.push("（密文过短，统计不可靠，结果仅供参考）");
  }
  lines.push("");
  const est = guessKeyLength(ct, maxLen);
  const target = 0.0667;
  const all = [];
  for (let L = 1; L <= Math.min(maxLen, 12); L++) {
    const cols = [];
    for (let i = 0; i < L; i++) {
      let col = "";
      for (let j = i; j < ct.length; j += L) col += ct[j];
      cols.push(col);
    }
    const avg = cols.reduce((s, c) => s + indexCoincidence(c), 0) / L;
    all.push({ L, avg });
  }
  lines.push("--- 各密钥长度平均 IC（接近 0.0667 为英语）---");
  for (const a of all) {
    lines.push(`  L=${String(a.L).padStart(2)}  IC=${a.avg.toFixed(4)}${a.L === est.L ? "  ← 选中" : ""}`);
  }
  lines.push("");
  const key = recoverVigenereKey(ct, est.L);
  const plain = vigenereDecode(ct, key);
  lines.push(`推断密钥长度：${est.L}`);
  lines.push(`恢复密钥：${key}`);
  lines.push("");
  lines.push("--- 解密结果 ---");
  lines.push(plain);
  return lines.join("\n");
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

const CORPUS = (
  "THE QUICK BROWN FOX JUMPS OVER THE LAZY DOG " +
  "PACK MY BOX WITH FIVE DOZEN LIQUOR JUGS " +
  "THE RAIN IN SPAIN STAYS MAINLY IN THE PLAIN " +
  "IT WAS THE BEST OF TIMES IT WAS THE WORST OF TIMES " +
  "WE HOLD THESE TRUTHS TO BE SELF EVIDENT THAT ALL MEN ARE CREATED EQUAL " +
  "THEY ARE ENDOWED BY THEIR CREATOR WITH CERTAIN UNALIENABLE RIGHTS " +
  "THAT AMONG THESE ARE LIFE LIBERTY AND THE PURSUIT OF HAPPINESS " +
  "GOVERNMENTS ARE INSTITUTED AMONG MEN DERIVING THEIR JUST POWERS " +
  "FROM THE CONSENT OF THE GOVERNED WHENEVER ANY FORM OF GOVERNMENT " +
  "BECOMES DESTRUCTIVE OF THESE ENDS IT IS THE RIGHT OF THE PEOPLE " +
  "TO ALTER OR TO ABOLISH IT AND TO INSTITUTE NEW GOVERNMENT " +
  "LAYING ITS FOUNDATION ON SUCH PRINCIPLES AND ORGANIZING ITS POWERS " +
  "IN SUCH FORM AS TO THEM SHALL SEEM MOST LIKELY TO EFFECT THEIR " +
  "SAFETY AND HAPPINESS PRUDENCE INDEED WILL DICTATE THAT GOVERNMENTS " +
  "LONG ESTABLISHED SHOULD NOT BE CHANGED FOR LIGHT AND TRANSIENT CAUSES " +
  "AND ACCORDINGLY ALL EXPERIENCE HATH SHOWN THAT MANKIND ARE MORE " +
  "DISPOSED TO SUFFER WHILE EVILS ARE SUFFERABLE THAN TO RIGHT THEMSELVES " +
  "BY ABOLISHING THE FORMS TO WHICH THEY ARE ACCUSTOMED " +
  "SCIENCE IS THE POETRY OF REALITY THE MOST BEAUTIFUL THING WE CAN " +
  "EXPERIENCE IS THE MYSTERIOUS IT IS THE SOURCE OF ALL TRUE ART " +
  "AND SCIENCE KNOWLEDGE IS POWER AND INFORMATION IS LIBERATING " +
  "EDUCATION IS THE PREMISE OF PROGRESS IN EVERY SOCIETY " +
  "IN EVERY FAMILY THE FUTURE OF OUR NATION DEPENDS ON THE EDUCATION " +
  "OF OUR CHILDREN THEY MUST BE PREPARED FOR THE CHALLENGES AHEAD"
);

// N-gram 频率表：quadgram 主信号 + trigram/bigram 回退（解决接近最优时四元组命中稀疏、梯度消失问题）
const _QUAD = new Map();
const _TRI = new Map();
const _BI = new Map();
{
  const c = cleanLetters(CORPUS);
  for (let i = 0; i + 4 <= c.length; i++) {
    const q = c.slice(i, i + 4);
    _QUAD.set(q, (_QUAD.get(q) || 0) + 1);
  }
  for (let i = 0; i + 3 <= c.length; i++) {
    const t = c.slice(i, i + 3);
    _TRI.set(t, (_TRI.get(t) || 0) + 1);
  }
  for (let i = 0; i + 2 <= c.length; i++) {
    const b = c.slice(i, i + 2);
    _BI.set(b, (_BI.get(b) || 0) + 1);
  }
}
const _LOG2 = Math.log(2);
// 适应度 = quadgram(主) + 0.3*trigram(辅助) + 0.1*bigram(兜底)
// 三层联合使真值文本 fitness 显著高于局部最优，且近最优区仍有密集梯度
function quadFitness(text) {
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
  desc: "IC 估密钥长度 + 列卡方恢复密钥 + 自动解密（英语统计）",
  params: [{ key: "maxKeyLen", label: "最大密钥长度", type: "number", default: 20 }],
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
};
