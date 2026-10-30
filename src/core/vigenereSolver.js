/*
 * vigenereSolver.js — 维吉尼亚自动求解（guballa.de 算法复刻）
 *
 * 核心不是「先猜密钥长度再按列卡方」，而是：
 *   对每个候选密钥长度 L，直接优化密钥；用相邻密钥字符解出的相邻明文
 *   bigram 总适应度来选密钥字符。加密变体（经典/Beaufort/变体 Beaufort/
 *   Autokey）只替换解密映射，优化框架不变。最后把 L=1..max 全部列出，
 *   并给出 flag 包装/crib 命中提示。
 *
 * 数据：语言 bigram log10 概率表（langProfiles.generated.js），由公开词频
 * 表派生，只存统计结果，不携带原文。
 */
import { LANG_PROFILES } from "./langProfiles.generated.js";

const AZ = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const COMMON_PREFIXES = [
  "flag", "ctf", "ctfshow", "nssctf", "dasctf", "hgame", "moectf",
  "buuctf", "iscc", "qsnctf", "ciscn", "n1ctf", "xctf", "sctf",
  "starctf", "glacier", "whctf", "bytectf", "geek",
];
const TIER_WEIGHT = 1e6;

export const VIGENERE_VARIANTS = {
  classic: "经典 Vigenère（C = P + K）",
  beaufort: "Beaufort（C = K − P）",
  variant: "变体 Beaufort（C = P − K）",
  autokey: "Autokey Vigenère（明文续密钥）",
};

const LANG_LABEL = { en: "英语", de: "德语", es: "西班牙语", fr: "法语", nl: "荷兰语", pt: "葡萄牙语" };

function lettersOnly(s) {
  return (s || "").toUpperCase().replace(/[^A-Z]/g, "");
}

// CTF 密文常带 { } 数字 下划线：加密只作用于字母，密钥索引也只随字母推进。
// 因此 bigram 适应度不能把「被数字/括号隔开的两个字母」当成相邻明文对。
function buildStream(text, start = 0) {
  const s = String(text || "");
  let letters = "";
  const adj = [];
  let prevLetter = false;
  for (let i = Math.max(0, start); i < s.length; i++) {
    const up = s[i].toUpperCase();
    if (up >= "A" && up <= "Z") {
      letters += up;
      adj.push(prevLetter);
      prevLetter = true;
    } else {
      prevLetter = false;
    }
  }
  return { letters, adj, start };
}

function detectWrapper(text) {
  const s = String(text || "");
  const m = /^[\s\uFEFF]*([A-Za-z][A-Za-z0-9_]{1,31})\{/.exec(s);
  if (!m) return null;
  const braceIndex = m.index + m[0].length - 1;
  return { prefix: m[1], braceIndex, contentStart: braceIndex + 1 };
}

function normalizeLang(lang) {
  const l = String(lang || "en").toLowerCase();
  return LANG_PROFILES[l] ? l : "en";
}

function decryptChar(c, k, variant) {
  if (variant === "beaufort") return (k - c + 26) % 26;
  if (variant === "variant") return (c + k) % 26;
  return (c - k + 26) % 26; // classic / autokey
}

// 保留原字符串的非字母位置（CTF flag 包装、数字、下划线等原样保留）
export function decryptPreserve(text, key, variant, opts = {}) {
  const k = lettersOnly(key);
  if (!k) return text;
  const s = String(text || "");
  const skipBefore = Math.max(0, Number(opts.skipBefore) || 0);
  let ki = 0;
  let out = "";
  const plain = [];
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    const up = ch.toUpperCase();
    if (up >= "A" && up <= "Z") {
      if (i < skipBefore) { out += ch; continue; }
      const c = up.charCodeAt(0) - 65;
      let kc;
      if (variant === "autokey") {
        kc = ki < k.length ? k[ki].charCodeAt(0) - 65 : plain[ki - k.length];
      } else {
        kc = k[ki % k.length].charCodeAt(0) - 65;
      }
      const p = decryptChar(c, kc, variant === "autokey" ? "classic" : variant);
      plain.push(p);
      const lower = ch >= "a" && ch <= "z";
      out += lower ? AZ[p].toLowerCase() : AZ[p];
      ki++;
    } else {
      out += ch;
    }
  }
  return out;
}

// 用纯字母串计算 bigram 适应度（log10 概率和，按 bigram 数平均）
function scoreLetters(ctLetters, key, variant, profile, adj) {
  const k = lettersOnly(key);
  if (!k) return -Infinity;
  let sum = 0, n = 0;
  const bi = profile.bi;
  const plain = [];
  for (let i = 0; i < ctLetters.length; i++) {
    const c = ctLetters.charCodeAt(i) - 65;
    let kc;
    if (variant === "autokey") kc = i < k.length ? k.charCodeAt(i) - 65 : plain[i - k.length];
    else kc = k.charCodeAt(i % k.length) - 65;
    const p = decryptChar(c, kc, variant === "autokey" ? "classic" : variant);
    plain.push(p);
    if (i > 0 && (!adj || adj[i])) { sum += bi[plain[i - 1] * 26 + p]; n++; }
  }
  return n ? sum / n : -Infinity;
}

// guballa 相邻密钥字符优化：对每个 (j, j+1) 枚举 26×26，保留最优，
// 再按左右两个 pair 的适应度决定每个密钥位取哪个候选字符。
function bestKeyClassic(ctLetters, L, variant, profile, adj) {
  const n = ctLetters.length;
  if (L <= 1) {
    let best = { key: "A", altKey: "A", score: -Infinity };
    for (let k = 0; k < 26; k++) {
      const key = AZ[k];
      const sc = scoreLetters(ctLetters, key, variant, profile, adj);
      if (sc > best.score) best = { key, altKey: key, score: sc };
    }
    return best;
  }
  const bi = profile.bi;
  const pairs = [];
  for (let j = 0; j < L; j++) {
    let best = { score: -Infinity, k1: 0, k2: 0 };
    for (let k1 = 0; k1 < 26; k1++) {
      for (let k2 = 0; k2 < 26; k2++) {
        let fit = 0, count = 0, fitAll = 0, countAll = 0;
        for (let i = j; i + 1 < n; i += L) {
          const c1 = ctLetters.charCodeAt(i) - 65;
          const c2 = ctLetters.charCodeAt(i + 1) - 65;
          const p1 = decryptChar(c1, k1, variant);
          const p2 = decryptChar(c2, k2, variant);
          const v = bi[p1 * 26 + p2];
          fitAll += v; countAll++;
          if (!adj || adj[i + 1]) { fit += v; count++; }
        }
        const score = count > 0 ? fit / count : (countAll > 0 ? fitAll / countAll : -Infinity);
        if (score > best.score) best = { score, k1, k2 };
      }
    }
    pairs.push(best);
  }
  const keyChars = new Array(L).fill(0);
  const altChars = new Array(L).fill(0);
  for (let j = 1; j < L; j++) {
    const left = pairs[j - 1];
    const right = pairs[j];
    const leftWins = left.score > right.score;
    keyChars[j] = leftWins ? left.k2 : right.k1;
    altChars[j] = leftWins ? left.k1 : right.k2;
  }
  const last = pairs[L - 1];
  const first = pairs[0];
  const lastWins = last.score > first.score;
  keyChars[0] = lastWins ? last.k2 : first.k1;
  altChars[0] = lastWins ? first.k1 : last.k2;
  const key = keyChars.map((x) => AZ[x]).join("");
  const altKey = altChars.map((x) => AZ[x]).join("");
  return { key, altKey, score: scoreLetters(ctLetters, key, variant, profile, adj) };
}

// Autokey：目标函数不是逐列独立，改用坐标下降（每个密钥位试 26 个字符）
function bestKeyAutokey(ctLetters, L, profile, seedKey, adj) {
  let key = seedKey && seedKey.length === L ? seedKey : "A".repeat(L);
  let bestScore = scoreLetters(ctLetters, key, "autokey", profile, adj);
  for (let pass = 0; pass < 6; pass++) {
    let improved = false;
    for (let j = 0; j < L; j++) {
      for (let k = 0; k < 26; k++) {
        const cand = key.slice(0, j) + AZ[k] + key.slice(j + 1);
        const sc = scoreLetters(ctLetters, cand, "autokey", profile, adj);
        if (sc > bestScore + 1e-12) { bestScore = sc; key = cand; improved = true; }
      }
    }
    if (!improved) break;
  }
  return { key, score: bestScore };
}

// pair 算法给出局部最优后，再用整段明文的 bigram 适应度做坐标下降，修掉
// 「相邻 pair 各自最优、拼起来却不是全局最优」的错位（guballa 原文也提到
// 额外用 trigram/其它算法精修）。
function refineKey(ctLetters, L, variant, profile, seedKey, adj) {
  let key = seedKey;
  let bestScore = scoreLetters(ctLetters, key, variant, profile, adj);
  for (let pass = 0; pass < 6; pass++) {
    let improved = false;
    for (let j = 0; j < L; j++) {
      const cur = key[j];
      let bestChar = cur;
      let bestLocal = bestScore;
      for (let k = 0; k < 26; k++) {
        if (AZ[k] === cur) continue;
        const cand = key.slice(0, j) + AZ[k] + key.slice(j + 1);
        const sc = scoreLetters(ctLetters, cand, variant, profile, adj);
        if (sc > bestLocal + 1e-12) { bestLocal = sc; bestChar = AZ[k]; }
      }
      if (bestChar !== cur) {
        key = key.slice(0, j) + bestChar + key.slice(j + 1);
        bestScore = bestLocal;
        improved = true;
      }
    }
    if (!improved) break;
  }
  return { key, score: bestScore };
}

function bestKeyForLength(ctLetters, L, variant, profile, adj) {
  if (variant === "autokey") {
    const seed = bestKeyClassic(ctLetters, L, "classic", profile, adj);
    let best = null;
    const seeds = [seed.key];
    if (seed.altKey && seed.altKey !== seed.key && (ctLetters.length <= 1200 || L <= 12)) seeds.push(seed.altKey);
    for (const s of seeds) {
      const r = bestKeyAutokey(ctLetters, L, profile, s, adj);
      if (!best || r.score > best.score) best = r;
    }
    return best;
  }
  const base = bestKeyClassic(ctLetters, L, variant, profile, adj);
  let best = null;
  const seeds = [base.key];
  if (base.altKey && base.altKey !== base.key && (ctLetters.length <= 1200 || L <= 12)) seeds.push(base.altKey);
  for (const s of seeds) {
    const r = refineKey(ctLetters, L, variant, profile, s, adj);
    if (!best || r.score > best.score) best = r;
  }
  return best;
}

// 从密文包装/用户 crib 推导密钥前缀（字母位置一一对应）
function cribKeyPrefix(ctLetters, plainPrefix, variant) {
  const p = lettersOnly(plainPrefix);
  const out = [];
  for (let i = 0; i < p.length && i < ctLetters.length; i++) {
    const c = ctLetters.charCodeAt(i) - 65;
    const pl = p.charCodeAt(i) - 65;
    let k;
    if (variant === "beaufort") k = (c + pl) % 26;
    else if (variant === "variant") k = (pl - c + 26) % 26;
    else k = (c - pl + 26) % 26;
    out.push(AZ[k]);
  }
  return out.join("");
}

function flagInfo(plain) {
  const s = String(plain || "").replace(/^\s+/, "");
  const m = /^([A-Za-z][A-Za-z0-9_]{1,31})\{([^{}]{1,65536})\}/.exec(s);
  if (!m) return { tier: 0, prefix: "" };
  const prefix = m[1];
  return { tier: COMMON_PREFIXES.includes(prefix.toLowerCase()) ? 2 : 1, prefix };
}

function scoreCandidate(plain, rawScore, opts = {}) {
  if (!Number.isFinite(rawScore)) return { score: -Infinity, tier: opts.tier || 0, prefix: "" };
  const info = flagInfo(plain);
  const tier = Math.max(info.tier, opts.tier || 0);
  const printableRatio = plain.replace(/[^\x20-\x7e\n]/g, "").length / Math.max(1, plain.length);
  return { score: tier * TIER_WEIGHT + rawScore + printableRatio * 0.5, tier, prefix: info.prefix };
}

function makeCandidate({ L, key, plain, raw, variant, lang, mode, source, cribTier = 0 }) {
  const info = scoreCandidate(plain, raw, { tier: cribTier });
  const score = Number.isFinite(info.score) ? info.score - L * 0.01 : info.score;
  return {
    L, key, plain, score, fitness: raw, raw,
    variant, lang, mode, source, tier: info.tier, flagPrefix: info.prefix,
  };
}

function compareCandidates(a, b) {
  const as = Number.isFinite(a.score) ? a.score : -Infinity;
  const bs = Number.isFinite(b.score) ? b.score : -Infinity;
  if (as !== bs) return bs - as;
  const af = Number.isFinite(a.fitness) ? a.fitness : -Infinity;
  const bf = Number.isFinite(b.fitness) ? b.fitness : -Infinity;
  if (af !== bf) return bf - af;
  if (a.L !== b.L) return a.L - b.L;
  if (a.mode !== b.mode) return a.mode === "full" ? -1 : 1;
  if (a.source !== b.source) return a.source === "length" ? -1 : 1;
  if (a.key !== b.key) return a.key < b.key ? -1 : 1;
  return 0;
}

/**
 * 结构化求解入口：返回每个密钥长度候选、排序结果与 top。
 * 候选包含 key/plain/score/fitness/variant/lang/mode/source。
 */
export function solveVigenereCandidates(text, p = {}) {
  const lang = normalizeLang(p.lang);
  const profile = LANG_PROFILES[lang];
  const variant = VIGENERE_VARIANTS[p.variant] ? p.variant : "classic";
  const layout = detectWrapper(text);
  const full = buildStream(text, 0);
  const content = layout ? buildStream(text, layout.contentStart) : null;
  const ct = full.letters;
  const maxLen = Math.max(1, Math.min(Math.floor(Number(p.maxKeyLen) || 20), 64, Math.max(1, ct.length)));
  const minLen = Math.max(1, Math.min(Math.floor(Number(p.minKeyLen) || 1), maxLen));
  const exact = Number(p.keyLen) > 0
    ? Math.max(1, Math.min(Math.floor(Number(p.keyLen)), Math.max(1, ct.length)))
    : null;
  const userCrib = String(p.crib || p.cribText || "").trim();
  const wrapperPrefix = layout ? layout.prefix : "";
  const autoCribs = [];
  if (userCrib) autoCribs.push(userCrib);
  if (wrapperPrefix) {
    autoCribs.push(wrapperPrefix);
    for (const c of COMMON_PREFIXES) if (!autoCribs.includes(c)) autoCribs.push(c);
  }

  const knownWrapper = layout && COMMON_PREFIXES.includes(layout.prefix.toLowerCase());
  const modes = [{ name: "full", stream: full }];
  if (content && (content.letters.length > 0 || knownWrapper)) modes.push({ name: "content", stream: content });
  const lenList = exact ? [exact] : Array.from({ length: maxLen - minLen + 1 }, (_, i) => minLen + i);

  const lengthRows = [];
  const bestByLen = new Map();
  for (const L of lenList) {
    const perMode = new Map();
    for (const mode of modes) {
      if (mode.stream.letters.length < L && L > 1) continue;
      const r = bestKeyForLength(mode.stream.letters, L, variant, profile, mode.stream.adj);
      const plain = decryptPreserve(text, r.key, variant, {
        skipBefore: mode.name === "content" ? layout.contentStart : 0,
      });
      const raw = mode.name === "content" && mode.stream.letters.length === 0 ? 0 : r.score;
      const cand = makeCandidate({
        L, key: r.key, plain, raw, variant, lang, mode: mode.name, source: "length",
      });
      perMode.set(mode.name, cand);
    }
    let best = null;
    for (const cand of perMode.values()) {
      if (!best || compareCandidates(cand, best) < 0) best = cand;
    }
    if (best) {
      lengthRows.push(best);
      bestByLen.set(L, perMode);
    }
  }

  let primaryMode = "full";
  if (layout && content && (content.letters.length > 0 || knownWrapper)) {
    if (knownWrapper) {
      primaryMode = "content";
    } else {
      let fullBest = -Infinity, contentBest = -Infinity;
      for (const x of lengthRows) {
        if (!Number.isFinite(x.raw)) continue;
        if (x.mode === "full") fullBest = Math.max(fullBest, x.raw);
        else if (x.mode === "content") contentBest = Math.max(contentBest, x.raw);
      }
      if (Number.isFinite(contentBest) && (!Number.isFinite(fullBest) || contentBest > fullBest + 0.15)) {
        primaryMode = "content";
      }
    }
  }
  const primary = modes.find((m) => m.name === primaryMode) || modes[0];

  const all = lengthRows.slice();
  const cribRows = [];
  const cribSeen = new Set();
  const userCribLetters = lettersOnly(userCrib);
  const wrapperLetters = layout ? lettersOnly(layout.prefix) : "";
  const contentCribs = userCribLetters && !(wrapperLetters && wrapperLetters.startsWith(userCribLetters))
    ? [userCrib]
    : [];
  const cribs = primaryMode === "full" ? autoCribs : contentCribs;
  for (const crib of cribs) {
    const c = lettersOnly(crib);
    if (!c) continue;
    const isUserCrib = userCrib && lettersOnly(userCrib) === c;
    for (const L of lenList) {
      const perMode = bestByLen.get(L);
      if (!perMode) continue;
      const base = perMode.get(primary.name);
      if (!base) continue;
      const take = Math.min(c.length, L);
      if (take < 1) continue;
      const prefix = cribKeyPrefix(primary.stream.letters, c.slice(0, take), variant);
      const key = prefix + base.key.slice(take);
      const id = `${primary.name}:${L}:${key}`;
      if (cribSeen.has(id)) continue;
      cribSeen.add(id);
      const plain = decryptPreserve(text, key, variant, {
        skipBefore: primary.name === "content" ? layout.contentStart : 0,
      });
      const raw = scoreLetters(primary.stream.letters, key, variant, profile, primary.stream.adj);
      const cand = makeCandidate({
        L, key, plain, raw, variant, lang, mode: primary.name, source: `crib:${crib}`,
        cribTier: isUserCrib && c.length >= 3 ? 3 : 0,
      });
      all.push(cand);
      cribRows.push(cand);
    }
  }

  all.sort(compareCandidates);
  cribRows.sort(compareCandidates);
  const lengthSorted = lengthRows.slice().sort((a, b) => a.L - b.L);
  const topLimit = Math.max(1, Math.min(Math.floor(Number(p.top) || 8), 30));
  const top = [];
  const topSeen = new Set();
  for (const x of all) {
    const id = `${x.L}:${x.key}:${x.plain}`;
    if (topSeen.has(id)) continue;
    topSeen.add(id);
    top.push(x);
    if (top.length >= topLimit) break;
  }

  return {
    input: String(text || ""),
    lang, variant,
    letters: ct.length,
    contentLetters: content ? content.letters.length : 0,
    wrapper: wrapperPrefix,
    candidates: all,
    lengthRows: lengthSorted,
    cribRows,
    top,
  };
}

/**
 * 主求解入口（保持原有字符串返回，兼容 vigenereAuto 等调用方）。
 * @param {string} text 密文
 * @param {object} p 参数：lang/variant/maxKeyLen/minKeyLen/keyLen/crib/all/top
 */
export function solveVigenere(text, p = {}) {
  const r = solveVigenereCandidates(text, p);
  const lines = [];
  lines.push("=== 维吉尼亚求解（guballa 相邻 bigram 算法）===");
  lines.push(`密文长度：${r.letters}（仅字母）`);
  lines.push(`语言：${LANG_LABEL[r.lang] || r.lang}（${r.lang}）　变体：${VIGENERE_VARIANTS[r.variant]}`);
  if (r.wrapper) {
    lines.push(`检测到前导包装前缀：${r.wrapper}{…}，同时按「整体参与加密」与「前缀不参与、仅正文加密」两种模式求解。`);
    if (r.contentLetters) lines.push(`正文长度：${r.contentLetters}（仅字母，跳过前缀）`);
  }
  if (r.letters < 20) lines.push("（密文过短，统计适应度不可靠；请优先看 crib 命中项）");
  lines.push("");

  const modeLabel = (x) => (x.mode === "content" ? "正文" : "整体");
  lines.push("--- 密钥长度全枚举（L=1..max，每个长度最优密钥）---");
  for (const x of r.lengthRows) {
    const tag = x.tier > 0 ? "  ← flag 结构" : "";
    lines.push(`L=${String(x.L).padStart(2)}  密钥=${x.key}  适应度=${x.raw.toFixed(3)}  模式=${modeLabel(x)}${tag}`);
    lines.push(`      ${x.plain.slice(0, 220)}`);
  }
  if (!r.lengthRows.length) lines.push("（无）");

  if (r.cribRows.length) {
    lines.push("");
    lines.push("--- crib / flag 前缀命中候选（按适应度排序）---");
    for (const x of r.cribRows.slice(0, 24)) {
      const tag = x.tier > 0 ? "  ← flag 结构" : "";
      lines.push(`L=${String(x.L).padStart(2)}  密钥=${x.key}  适应度=${x.raw.toFixed(3)}  模式=${modeLabel(x)} [${x.source.slice(5)}]${tag}`);
      lines.push(`      ${x.plain.slice(0, 220)}`);
    }
    if (r.cribRows.length > 24) lines.push(`…（共 ${r.cribRows.length} 条 crib 候选，已截断显示）`);
  }

  lines.push("");
  lines.push("--- 最佳候选 ---");
  for (let i = 0; i < r.top.length; i++) {
    const x = r.top[i];
    lines.push(`#${i + 1}  L=${x.L}  密钥=${x.key}  适应度=${x.raw.toFixed(3)}  模式=${modeLabel(x)}  来源=${x.source}`);
    lines.push(x.plain);
    lines.push("");
  }
  if (!r.candidates.length) lines.push("（无可用解：密文为空或参数不合法）");
  lines.push("提示：适应度是语言 bigram 统计，不等于正确性；短密文下长密钥会过拟合，CTF 优先看 flag 结构/crib 命中项。");
  return lines.join("\n");
}

// ============================================================
// 单表替换求解（多语言，guballa Substitution Solver 的本地版）
// ============================================================
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function subScore(ctD, key, bi) {
  let score = 0;
  for (let i = 1; i < ctD.length; i++) score += bi[key[ctD[i - 1]] * 26 + key[ctD[i]]];
  return ctD.length > 1 ? score / (ctD.length - 1) : -Infinity;
}

/**
 * 多语言单表替换爬山。返回 { key, plain, score, lang }。
 * key[cipherIndex] = plainIndex，标准 26 字母置换。
 */
export function substitutionCrackLang(text, lang = "en", opts = {}) {
  const profile = LANG_PROFILES[normalizeLang(lang)];
  const ct = lettersOnly(text);
  if (ct.length < 10) throw new Error("密文过短（需 ≥10 字母）");
  const ctD = new Uint8Array(ct.length);
  for (let i = 0; i < ct.length; i++) ctD[i] = ct.charCodeAt(i) - 65;
  const iterations = Math.max(1000, Math.min(Number(opts.iterations) || 30000, 300000));
  const restarts = Math.max(1, Math.min(Number(opts.restarts) || 6, 30));
  const seed = Number(opts.seed) || 20261027;
  const rng = mulberry32(seed);

  const freq = new Array(26).fill(0);
  for (const c of ctD) freq[c]++;
  const monoOrder = profile.mono.map((v, i) => [v, i]).sort((a, b) => b[0] - a[0]).map((x) => x[1]);
  const cipherOrder = freq.map((v, i) => [v, i]).sort((a, b) => b[0] - a[0]).map((x) => x[1]);
  const base = new Array(26).fill(0);
  for (let i = 0; i < 26; i++) base[cipherOrder[i]] = monoOrder[i];

  let best = null;
  for (let r = 0; r < restarts; r++) {
    let key = base.slice();
    if (r > 0) {
      for (let i = key.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [key[i], key[j]] = [key[j], key[i]];
      }
    }
    let cur = subScore(ctD, key, profile.bi);
    for (let it = 0; it < iterations; it++) {
      const a = Math.floor(rng() * 26), b = Math.floor(rng() * 26);
      if (a === b) continue;
      const t = key[a]; key[a] = key[b]; key[b] = t;
      const sc = subScore(ctD, key, profile.bi);
      if (sc >= cur) cur = sc;
      else { const u = key[a]; key[a] = key[b]; key[b] = u; }
      if (it > 0 && it % 4096 === 0) {
        key = best ? best.key.slice() : key;
        cur = best ? subScore(ctD, key, profile.bi) : cur;
        for (let s = 0; s < 3; s++) {
          const x = Math.floor(rng() * 26), y = Math.floor(rng() * 26);
          const z = key[x]; key[x] = key[y]; key[y] = z;
        }
        cur = subScore(ctD, key, profile.bi);
      }
    }
    if (!best || cur > best.score) best = { key: key.slice(), score: cur };
  }
  const keyStr = best.key.map((x) => AZ[x]).join("");
  const plain = ct.replace(/[A-Z]/g, (ch) => AZ[best.key[ch.charCodeAt(0) - 65]]);
  return { key: keyStr, plain, score: best.score, lang: normalizeLang(lang) };
}

export function formatSubstitutionReport(text, lang = "en", opts = {}) {
  const r = substitutionCrackLang(text, lang, opts);
  const name = { en: "英语", de: "德语", es: "西班牙语", fr: "法语", nl: "荷兰语", pt: "葡萄牙语" }[r.lang] || r.lang;
  const lines = [];
  lines.push("=== 单表替换求解（多语言 bigram 爬山） ===");
  lines.push(`语言：${name}（${r.lang}）　字母数：${lettersOnly(text).length}`);
  lines.push(`适应度：${r.score.toFixed(4)}（越高越像目标语言）`);
  lines.push("");
  lines.push("=== 映射（密文 → 明文）===");
  lines.push([...r.key].map((ch, i) => `${AZ[i]}→${ch}`).join("  "));
  lines.push("");
  lines.push("=== 解密结果 ===");
  lines.push(r.plain);
  lines.push("");
  lines.push("提示：单表替换是启发式搜索，不保证全局最优；短文本请结合词形/已知词人工确认。");
  return lines.join("\n");
}

export default { solveVigenere, solveVigenereCandidates, VIGENERE_VARIANTS, decryptPreserve, substitutionCrackLang, formatSubstitutionReport };
