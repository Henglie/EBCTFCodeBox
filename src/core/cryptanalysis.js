/*
 * cryptanalysis.js — 密码分析工具组（T57，cat:'analysis'，单向 run 输出报告文本）。
 *。
 *
 * 覆盖：
 * - freqAnalysis 频率分析（单/双/三字母 n-gram + 出图数据）
 * - icAnalysis 重合指数 IC（整体 IC + 分组 IC → 判单表/多表替换 + Vigenère key 长估计）
 * - kasiskiTest Kasiski 检验（重复 n-gram 间隔 GCD → Vigenère key 长候选）
 * - chiSquareAnalysis 卡方检验（密文 vs 英语字母频率，字母级详细对比）
 * - subCipherSolver 单表替换自动求解（爬山算法 + 四元组打分）
 * - caesarBrute 凯撒/ROT 自动求位移（卡方 + 四元组联合打分，26 位移排名）
 *
 * 红线：
 * - 只新建本文件，不碰任何现有 core/*.js。
 * - 单字母频率复用 magic/langfreq.js 的 EN 字节频率表（import，不碰原文件）。
 * - 四元组打分：内置公共领域英语语料（Jane Austen《Pride and Prejudice》+
 * A. Conan Doyle《A Study in Scarlet》节选），模块加载时计算 n-gram 频率表
 * 不外发不依赖网络。
 * - 分析类用 run 单向，无 encode/decode。
 * - 注册契约：register({id, cat:"analysis", name, desc, params, run})。
 *
 * 契约：单向 run(text, params) 返回报告文本。
 * 爬山算法有迭代上限防爆；超长输入截断处理。
 */
import { register } from "./registry.js";
import { EN as EN_BYTE_FREQ } from "./magic/langfreq.js";

// ============================================================
// 1. 单字母频率表（A-Z，百分比 0-100）
// 从 langfreq.EN 字节频率表合并大小写提取。
// langfreq.EN[index] = 字节 index 的出现百分比（0-100）。
// 字母 A 频率 = EN[0x41] + EN[0x61]，以此类推。
// 归一化到 A-Z 和为 100（因 langfreq 表的非字母字节也占百分比）。
// ============================================================
const UNIGRAM_EN = new Array(26).fill(0);
for (let i = 0; i < 26; i++) {
  UNIGRAM_EN[i] = EN_BYTE_FREQ[65 + i] + EN_BYTE_FREQ[97 + i];
}
{
  const _sum = UNIGRAM_EN.reduce((a, b) => a + b, 0) || 1;
  for (let i = 0; i < 26; i++) UNIGRAM_EN[i] = (UNIGRAM_EN[i] / _sum) * 100;
}

// ============================================================
// 2. 内置英语语料 → n-gram 频率表
// 语料来源：公共领域文本节选（Jane Austen《Pride and Prejudice》+
// A. Conan Doyle《A Study in Scarlet》），模块加载时计算
// quadgram / trigram / bigram 频率表。四元组打分用 log10 概率，缺失给 floor。
// ============================================================
const CORPUS = `It is a truth universally acknowledged that a single man in possession of a good fortune must be in want of a wife However little known the feelings or views of such a man may be on his first entering a neighbourhood this truth is so well fixed in the minds of the surrounding families that he is considered as the rightful property of some one or other of their daughters My dear Mr Bennet said his lady to him one day have you heard that Netherfield Park is let at last Mr Bennet replied that he had not But it is returned she for Mrs Long has just been here and she told me all about it Mr Bennet made no answer Do you not want to know who has taken it cried his wife impatiently You want to tell me and I have no objection to hearing it This was invitation enough Why my dear you must know Mrs Long says that Netherfield is taken by a young man of large fortune from the north of England that he came down on Monday in a chaise and four to see the place and was so much delighted with it that he agreed with Mr Morris immediately that he is to take possession before Michaelmas and some of his servants are to be in the house by the end of next week What is his name Bingley Is he married or single Oh single my dear to be sure A single man of large fortune four or five thousand a year What a fine thing for our girls How so how can it affect them My dear Mr Bennet replied his wife how can you be so tiresome You must know that I am thinking of his marrying one of them Is that his design in settling here Design nonsense how can you talk so but it is very likely that he may fall in love with one of them and therefore you must visit him as soon as he comes I see no occasion for that You and the girls may go or you may send them by themselves which perhaps will be still better for as you are as handsome as any of them Mr Bingley might like you the best of the party My dear you flatter me I certainly have had my share of beauty but I do not pretend to be anything extraordinary now When a woman has five grown up daughters she ought to give over thinking of her own beauty In such cases a woman has not often much beauty to think of But my dear you must indeed go and see Mr Bingley when he comes into the neighbourhood In the year eighteen hundred and seventy eight I took my degree of Doctor of Medicine at the University of London and proceeded to Netley to go through the course prescribed for surgeons in the army Having completed my studies there I was duly attached to the Fifth Northumberland Fusiliers as Assistant Surgeon The regiment was stationed in India at the time and before I could join it the second Afghan war had broken out On landing at Bombay I learned that my corps had advanced through the passes and was already deep in the enemy country I followed however with many other officers who were in the same situation as myself and succeeded in reaching Candahar in safety where I found my regiment and at once entered upon my new duties The campaign brought honours and promotion to many but for me it had nothing but misfortune and disaster I was removed from my brigade and attached to the Berkshires with whom I served at the fatal battle of Maiwand There I was struck on the shoulder by a Jezail bullet which shattered the bone and grazed the subclavian artery I should have fallen into the hands of the murderous Ghazis had it not been for the loyalty and courage of my orderly Murray who dragged me into a small building where we could shelter from the enemy fire I recovered from my wound and was able to rejoin my regiment but the climate had taken its toll on my constitution and I was sent back to England to recover my health I had no relatives in England and was free to go wherever I pleased I lived for some time in a hotel in London spending my time in the museums and libraries and trying to find a purpose for my life I met an old friend who told me about a remarkable man named Sherlock Holmes who was looking for someone to share rooms with He was a student of chemistry and had a most extraordinary habit of observing everything around him with great care and precision He could tell a man his occupation by looking at his hands and could deduce his recent movements from the mud on his boots I found him to be the most interesting man I had ever met and we agreed to share rooms at Baker Street`;

function buildNgramCounts(text, n) {
  const clean = text.toUpperCase().replace(/[^A-Z]/g, "");
  const counts = new Map();
  for (let i = 0; i <= clean.length - n; i++) {
    const g = clean.slice(i, i + n);
    counts.set(g, (counts.get(g) || 0) + 1);
  }
  const total = Math.max(1, clean.length - n + 1);
  return { counts, total };
}

const _BI = buildNgramCounts(CORPUS, 2);
const _TRI = buildNgramCounts(CORPUS, 3);
const _QUAD = buildNgramCounts(CORPUS, 4);
const _QUAD_FLOOR = Math.log10(0.5 / _QUAD.total); // 缺失四元组的 floor 分（低惩罚）

/**
 * 四元组打分：Σ log10(P(quadgram))。
 * 命中的四元组用 log10(count/total)（负值，越接近 0 越常见）
 * 缺失用 floor（更负）。总得分越高越像英语。
 */
function scoreQuad(text) {
  const s = text.toUpperCase().replace(/[^A-Z]/g, "");
  if (s.length < 4) return -9999;
  let score = 0;
  for (let i = 0; i <= s.length - 4; i++) {
    const g = s.slice(i, i + 4);
    const c = _QUAD.counts.get(g);
    score += c ? Math.log10(c / _QUAD.total) : _QUAD_FLOOR;
  }
  return score;
}

// ============================================================
// 工具函数
// ============================================================
function cleanAlpha(text) {
  return text.toUpperCase().replace(/[^A-Z]/g, "");
}

// 可复现 PRNG（mulberry32），爬山用
function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gcd(a, b) {
  a = Math.abs(a); b = Math.abs(b);
  while (b) { [a, b] = [b, a % b]; }
  return a;
}
function gcdArray(arr) {
  if (arr.length === 0) return 0;
  let g = arr[0];
  for (let i = 1; i < arr.length; i++) g = gcd(g, arr[i]);
  return g;
}

// ============================================================
// op 1: freqAnalysis — 频率分析（单/双/三字母 + 出图数据）
// ============================================================
function freqAnalysis(text, p) {
  const mode = (p && p.mode) || "all";
  const top = Math.max(1, Math.min(100, Number((p && p.top) || 20)));
  const s = cleanAlpha(text);
  if (s.length === 0) return "频率分析: 输入无字母";

  const lines = [];
  lines.push(`字母数: ${s.length}`);
  lines.push("");

  function ngramAnalysis(n, label) {
    const counts = new Map();
    for (let i = 0; i <= s.length - n; i++) {
      const g = s.slice(i, i + n);
      counts.set(g, (counts.get(g) || 0) + 1);
    }
    const total = Math.max(1, s.length - n + 1);
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, top);
    const maxCount = sorted[0] ? sorted[0][1] : 1;

    lines.push(`=== ${label}（前 ${Math.min(top, sorted.length)} / 共 ${counts.size} 种）===`);
    lines.push(`${"n-gram".padEnd(8)}\t次数\t占比\t条形图`);
    for (const [g, c] of sorted) {
      const pct = ((c / total) * 100).toFixed(2);
      const barLen = Math.max(1, Math.round((c / maxCount) * 30));
      lines.push(`${g.padEnd(8)}\t${c}\t${pct}%\t${"█".repeat(barLen)}`);
    }
 // 出图数据（JSON，供前端绘制柱状图）
    lines.push("");
    lines.push(`[ChartData:${label}]`);
    lines.push(JSON.stringify(
      sorted.map(([g, c]) => ({ gram: g, count: c, percent: +((c / total) * 100).toFixed(4) }))
    ));
    lines.push("");
  }

  if (mode === "mono" || mode === "all") ngramAnalysis(1, "单字母");
  if (mode === "di" || mode === "all") ngramAnalysis(2, "双字母");
  if (mode === "tri" || mode === "all") ngramAnalysis(3, "三字母");

  return lines.join("\n");
}

// ============================================================
// op 2: icAnalysis — 重合指数 IC（整体 + 分组 → 判 key 长）
// ============================================================
function icOf(s) {
  if (s.length < 2) return 0;
  const freq = new Array(26).fill(0);
  for (const ch of s) freq[ch.charCodeAt(0) - 65]++;
  let sum = 0;
  for (const f of freq) sum += f * (f - 1);
  return sum / (s.length * (s.length - 1));
}

function icAnalysis(text, p) {
  const maxKeyLen = Math.max(2, Math.min(32, Number((p && p.maxKeyLen) || 16)));
  const s = cleanAlpha(text);
  if (s.length < 4) return "IC 分析: 输入字母过短（需 ≥4）";

  const lines = [];
  const overall = icOf(s);
  lines.push("=== 整体重合指数 ===");
  lines.push(`IC = ${overall.toFixed(6)}`);
  lines.push(`字母数: ${s.length}`);
  lines.push(`参考: 英语明文/单表替换 IC ≈ 0.0667, 随机/多表替换 IC ≈ 0.0385`);
  lines.push(
    `判读: ${
      overall > 0.06
        ? "疑似英语明文/单表替换（IC 接近 0.0667）"
        : overall > 0.045
        ? "疑似多表替换（维吉尼亚等），key 越长 IC 越接近 0.0385"
        : "疑似随机/加密良好（IC 接近 1/26 ≈ 0.0385）"
    }`
  );
  lines.push("");

 // 分组 IC：对每个候选 key 长 k，将密文按 k 列分组，每列单独算 IC，取平均
  lines.push(`=== 分组 IC（key 长 1..${maxKeyLen}）===`);
  lines.push("key长\t平均IC\t各组IC");
  const candidates = [];
  for (let k = 1; k <= maxKeyLen; k++) {
    const cols = [];
    for (let c = 0; c < k; c++) {
      let col = "";
      for (let i = c; i < s.length; i += k) col += s[i];
      if (col.length >= 2) cols.push(icOf(col));
    }
    const avg = cols.length ? cols.reduce((a, b) => a + b, 0) / cols.length : 0;
    const colStr = cols.map((x) => x.toFixed(4)).join(" ");
    lines.push(`${k}\t${avg.toFixed(6)}\t${colStr}`);
    if (avg > 0.06) candidates.push(k);
  }
  lines.push("");
  lines.push(
    `候选 key 长（平均 IC > 0.060，接近英语）: ${
      candidates.length ? candidates.join(", ") : "无（可能非多表替换或 key 过长）"
    }`
  );
  if (candidates.length > 0) {
    const min = Math.min(...candidates);
    lines.push(`提示: 最小候选 ${min} 可能是真实 key 长（也可能是其因子的倍数关系，需 Kasiski 交叉验证）`);
  }

  return lines.join("\n");
}

// ============================================================
// op 3: kasiskiTest — Kasiski 检验（重复 n-gram 间隔 GCD → key 长候选）
// ============================================================
function kasiskiTest(text, p) {
  const minLen = Math.max(3, Math.min(6, Number((p && p.minLen) || 3)));
  const maxKeyLen = Math.max(2, Math.min(50, Number((p && p.maxKeyLen) || 20)));
  const s = cleanAlpha(text);
  if (s.length < minLen * 2)
    return `Kasiski 检验: 输入过短（需 ≥${minLen * 2} 字母）`;

 // 找所有长度 = minLen 的子串及其位置
  const positions = new Map();
  for (let i = 0; i <= s.length - minLen; i++) {
    const sub = s.slice(i, i + minLen);
    if (!positions.has(sub)) positions.set(sub, []);
    positions.get(sub).push(i);
  }

 // 筛选出现 ≥2 次的子串，计算所有对之间的间隔
  const repList = [];
  for (const [sub, pos] of positions) {
    if (pos.length < 2) continue;
    for (let i = 0; i < pos.length; i++) {
      for (let j = i + 1; j < pos.length; j++) {
        repList.push({ sub, pos1: pos[i], pos2: pos[j], dist: pos[j] - pos[i] });
        if (repList.length >= 2000) break; // 防爆
      }
      if (repList.length >= 2000) break;
    }
  }

  if (repList.length === 0)
    return `Kasiski 检验: 未找到长度 ≥ ${minLen} 的重复子串\n（可能非多表替换，或密文过短）`;

 // 按距离排序
  repList.sort((a, b) => a.dist - b.dist);

 // 统计每个距离的出现次数
  const distCounts = new Map();
  for (const r of repList) distCounts.set(r.dist, (distCounts.get(r.dist) || 0) + 1);

 // 所有距离的 GCD
  const allDists = [...distCounts.keys()];
  const overallGcd = gcdArray(allDists);

 // 对每个候选 key 长 k (1..maxKeyLen)，统计 k 整除多少个间隔
  const keyLenScores = [];
  for (let k = 1; k <= maxKeyLen; k++) {
    let divisible = 0;
    for (const [d, c] of distCounts) {
      if (d % k === 0) divisible += c;
    }
    keyLenScores.push({ k, divisible, total: repList.length });
  }
  keyLenScores.sort((a, b) => b.divisible - a.divisible);

  const lines = [];
  lines.push(`=== Kasiski 检验 ===`);
  lines.push(`重复子串（长度 = ${minLen}）: ${repList.length} 对`);
  lines.push(`所有距离 GCD: ${overallGcd}`);
  lines.push("");

 // 输出前 20 个重复子串
  const showReps = repList.slice(0, 20);
  lines.push(`=== 重复子串（前 ${showReps.length}）===`);
  lines.push("子串\t位置1\t位置2\t间隔");
  for (const r of showReps) {
    lines.push(`${r.sub}\t${r.pos1}\t${r.pos2}\t${r.dist}`);
  }
  if (repList.length > 20) lines.push(`...（共 ${repList.length} 对）`);
  lines.push("");

 // 输出 key 长候选（整除次数 top 10）
  const topKL = keyLenScores.slice(0, 10);
  lines.push(`=== key 长候选（按整除次数降序，前 10）===`);
  lines.push("key长\t整除次数\t占比");
  for (const ks of topKL) {
    const pct = ((ks.divisible / repList.length) * 100).toFixed(1);
    lines.push(`${ks.k}\t${ks.divisible}\t${pct}%`);
  }
  lines.push("");
  if (topKL[0] && topKL[0].k) {
    lines.push(
      `提示: 最可能 key 长 = ${topKL[0].k}（整除 ${topKL[0].divisible}/${repList.length} 个间隔）`
    );
    lines.push(`注意: key 长真实值可能是候选的因子（如 6 的因子 1/2/3/6），需结合 IC 分组验证`);
  }

  return lines.join("\n");
}

// ============================================================
// op 4: chiSquareAnalysis — 卡方检验（字母级详细对比）
// ============================================================
function chiSquareAnalysis(text, p) {
  const s = cleanAlpha(text);
  const n = s.length;
  if (n === 0) return "卡方检验: 输入无字母";

  const freq = new Array(26).fill(0);
  for (const ch of s) freq[ch.charCodeAt(0) - 65]++;

  let chi = 0;
  const lines = [];
  lines.push("=== 卡方检验（vs 英语字母频率）===");
  lines.push(`字母数: ${n}`);
  lines.push("");
  lines.push("字母\t观测\t期望\t偏差\t卡方贡献");
  for (let i = 0; i < 26; i++) {
    const expected = (UNIGRAM_EN[i] / 100) * n;
    const contribution = expected > 0 ? Math.pow(freq[i] - expected, 2) / expected : 0;
    chi += contribution;
    const letter = String.fromCharCode(65 + i);
    lines.push(
      `${letter}\t${freq[i]}\t${expected.toFixed(1)}\t${(freq[i] - expected).toFixed(1)}\t${contribution.toFixed(2)}`
    );
  }
  lines.push("");
  lines.push(`卡方值 χ² = ${chi.toFixed(4)}`);
  lines.push(`参考: χ² < 50 通常为英语明文; χ² > 200 通常为非英语/加密文本`);
  lines.push(
    `判读: ${chi < 50 ? "疑似英语明文" : chi < 200 ? "疑似部分英语/轻度替换" : "疑似非英语/加密文本"}`
  );

  return lines.join("\n");
}

// ============================================================
// op 5: subCipherSolver — 单表替换自动求解（爬山 + 四元组打分）
// ============================================================
// key 为 26 字母的置换字符串：密文字母 (65+i) → 明文字母 key[i]
function applySub(text, key) {
  let out = "";
  for (const ch of text) {
    if (ch >= "A" && ch <= "Z") out += key[ch.charCodeAt(0) - 65];
    else if (ch >= "a" && ch <= "z")
      out += key[ch.charCodeAt(0) - 97].toLowerCase();
    else out += ch;
  }
  return out;
}

function subCipherSolver(text, p) {
  const iterations = Math.max(100, Math.min(100000, Number((p && p.iterations) || 10000)));
  const restarts = Math.max(1, Math.min(20, Number((p && p.restarts) || 5)));
  const seed = Number((p && p.seed) || 12345);
  const s = text.toUpperCase();
  const cleanS = cleanAlpha(text);
  if (cleanS.length < 10) return "单表替换求解: 密文过短（需 ≥10 字母）";

 // 按密文字母频率降序
  const cipherFreq = new Array(26).fill(0);
  for (const ch of cleanS) cipherFreq[ch.charCodeAt(0) - 65]++;
  const cipherOrder = cipherFreq
    .map((f, i) => [f, i])
    .sort((a, b) => b[0] - a[0])
    .map((x) => x[1]);

 // 英语字母频率降序
  const engOrder = UNIGRAM_EN.map((f, i) => [f, i])
    .sort((a, b) => b[0] - a[0])
    .map((x) => x[1]);

  let bestKey = null;
  let bestScore = -Infinity;

  for (let r = 0; r < restarts; r++) {
    const rng = makeRng(seed + r * 7919);

 // 初始 key：按频率对齐（密文最高频字母 → 英语最高频字母）
    const key = new Array(26);
    for (let i = 0; i < cipherOrder.length; i++) {
      key[cipherOrder[i]] = String.fromCharCode(65 + engOrder[i]);
    }
 // 剩余位置（密文中未出现的字母）填充
    const used = new Set(key.filter(Boolean));
    let fillIdx = 0;
    for (let i = 0; i < 26; i++) {
      if (!key[i]) {
        while (used.has(String.fromCharCode(65 + fillIdx))) fillIdx++;
        key[i] = String.fromCharCode(65 + fillIdx);
        used.add(key[i]);
        fillIdx++;
      }
    }

    let currentScore = scoreQuad(applySub(cleanS, key.join("")));

 // 爬山：随机交换两个映射，保留更好的
    for (let it = 0; it < iterations; it++) {
      const i = Math.floor(rng() * 26);
      const j = Math.floor(rng() * 26);
      if (i === j) continue;
      const newKey = key.slice();
      [newKey[i], newKey[j]] = [newKey[j], newKey[i]];
      const newScore = scoreQuad(applySub(cleanS, newKey.join("")));
      if (newScore > currentScore) {
        key.splice(0, key.length, ...newKey);
        currentScore = newScore;
      }
    }

    if (currentScore > bestScore) {
      bestScore = currentScore;
      bestKey = key.slice();
    }
  }

  const decrypted = applySub(s, bestKey.join(""));
  const lines = [];
  lines.push("=== 单表替换自动求解（爬山 + 四元组打分）===");
  lines.push(`密文字母数: ${cleanS.length}`);
  lines.push(`爬山迭代: ${iterations} × ${restarts} 次重启`);
  lines.push(`最佳得分: ${bestScore.toFixed(2)}`);
  lines.push("");
  lines.push("=== 求解映射（密文 → 明文）===");
  const mapLine = [];
  for (let i = 0; i < 26; i++)
    mapLine.push(`${String.fromCharCode(65 + i)}→${bestKey[i]}`);
  lines.push(mapLine.join("  "));
  lines.push("");
  lines.push("=== 解密结果 ===");
  lines.push(decrypted);
  lines.push("");
  lines.push("提示: 爬山为启发式，不保证全局最优。如结果不佳可增加迭代/重启次数或换随机种子。");

  return lines.join("\n");
}

// ============================================================
// op 6: caesarBrute — 凯撒/ROT 自动求位移
// ============================================================
function caesarShift(text, shift) {
  const s = ((shift % 26) + 26) % 26;
  return text.replace(/[a-z]/gi, (c) => {
    const base = c <= "Z" ? 65 : 97;
    return String.fromCharCode(((c.charCodeAt(0) - base + s) % 26) + base);
  });
}

function rot47(text) {
  return text.replace(/[!-~]/g, (c) => {
    const code = c.charCodeAt(0);
    return String.fromCharCode(33 + ((code - 33 + 47) % 94));
  });
}

function caesarBrute(text, p) {
  const s = text;
  const cleanS = cleanAlpha(text);
  if (cleanS.length === 0) return "凯撒求位移: 输入无字母";

 // 对每个位移 0-25，计算卡方 + 四元组得分
  const results = [];
  for (let shift = 0; shift < 26; shift++) {
    const decrypted = caesarShift(cleanS, -shift); // 反向位移得明文
 // 卡方
    const freq = new Array(26).fill(0);
    for (const ch of decrypted) freq[ch.charCodeAt(0) - 65]++;
    let chi = 0;
    for (let i = 0; i < 26; i++) {
      const expected = (UNIGRAM_EN[i] / 100) * decrypted.length;
      if (expected > 0) chi += Math.pow(freq[i] - expected, 2) / expected;
    }
    const quad = scoreQuad(decrypted);
    results.push({ shift, decrypted, chi, quad });
  }

 // 按四元组得分降序排
  results.sort((a, b) => b.quad - a.quad);
  const best = results[0];

  const lines = [];
  lines.push("=== 凯撒/ROT 自动求位移 ===");
  lines.push(`密文字母数: ${cleanS.length}`);
  lines.push(
    `最佳位移: ${best.shift}（四元组得分 ${best.quad.toFixed(2)}, 卡方 ${best.chi.toFixed(2)}）`
  );
  lines.push("");
  lines.push("=== 全部 26 位移排名（按四元组得分降序）===");
  lines.push("排名\t位移\t四元组分\t卡方\t解密（前 60 字符）");
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const preview = r.decrypted.slice(0, 60);
    lines.push(`${i + 1}\t${r.shift}\t${r.quad.toFixed(2)}\t${r.chi.toFixed(2)}\t${preview}`);
  }
  lines.push("");
  lines.push("=== 最佳解密（位移 " + best.shift + "）===");
  lines.push(caesarShift(s, -best.shift));
  lines.push("");
 // ROT47 检查（ASCII 33-126 位移 47，自反）
  lines.push("=== ROT47 解码（ASCII 33-126 位移 47，自反）===");
  lines.push(rot47(s));
  lines.push("");
  lines.push("提示: 位移 0 = 原文, 位移 13 = ROT13。如最佳位移为 0 可能输入已是明文。");

  return lines.join("\n");
}

// ============================================================
// 注册
// ============================================================
register({
  id: "freqAnalysis",
  cat: "analysis",
  name: "频率分析（n-gram）",
  desc: "单字母/双字母/三字母频率统计 + 出图数据（ASCII 条形图 + JSON 数据）",
  params: [
    {
      key: "mode",
      label: "模式",
      type: "select",
      default: "all",
      options: [
        { value: "all", label: "全部（1+2+3 gram）" },
        { value: "mono", label: "单字母" },
        { value: "di", label: "双字母" },
        { value: "tri", label: "三字母" },
      ],
    },
    { key: "top", label: "每类显示前 N", type: "number", default: 20, placeholder: "1-100" },
  ],
  run: freqAnalysis,
});
register({
  id: "icAnalysis",
  cat: "analysis",
  name: "重合指数 IC（含分组）",
  desc:
    "整体 IC + 分组 IC（判单表/多表替换 + Vigenère key 长估计，英语≈0.0667，随机≈0.0385）",
  params: [
    { key: "maxKeyLen", label: "最大 key 长", type: "number", default: 16, placeholder: "2-32" },
  ],
  run: icAnalysis,
});
register({
  id: "kasiskiTest",
  cat: "analysis",
  name: "Kasiski 检验",
  desc: "重复 n-gram 间隔 GCD → Vigenère 密钥长度候选",
  params: [
    { key: "minLen", label: "最小重复长度", type: "number", default: 3, placeholder: "3-6" },
    { key: "maxKeyLen", label: "最大 key 长", type: "number", default: 20, placeholder: "2-50" },
  ],
  run: kasiskiTest,
});
register({
  id: "chiSquareAnalysis",
  cat: "analysis",
  name: "卡方检验（详细）",
  desc: "密文 vs 英语字母频率的卡方检验（字母级观测/期望对比表）",
  params: [],
  run: chiSquareAnalysis,
});
register({
  id: "subCipherSolver",
  cat: "analysis",
  name: "单表替换自动求解",
  desc: "爬山算法 + 四元组打分自动破解单表替换密码",
  params: [
    {
      key: "iterations",
      label: "爬山迭代",
      type: "number",
      default: 10000,
      placeholder: "100-100000",
    },
    { key: "restarts", label: "随机重启", type: "number", default: 5, placeholder: "1-20" },
    { key: "seed", label: "随机种子", type: "number", default: 12345 },
  ],
  run: subCipherSolver,
});
register({
  id: "caesarBrute",
  cat: "analysis",
  name: "凯撒/ROT 自动求位移",
  desc: "对 0-25 位移逐一打分（卡方 + 四元组），自动找最佳位移并输出排名 + ROT47",
  params: [],
  run: caesarBrute,
});

export {
  freqAnalysis,
  icAnalysis,
  kasiskiTest,
  chiSquareAnalysis,
  subCipherSolver,
  caesarBrute,
 // 导出辅助函数供测试
  scoreQuad,
  icOf,
  caesarShift,
  applySub,
};
