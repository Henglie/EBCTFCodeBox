/*
 * dcode-extras · Agent D3 批次（2026-10）
 *
 * 范围：dCode 的 Jeux de Lettres / Fun-Divers / Jeux de Nombres / Jeux de Société /
 *       Jeux sur Mobile / Recherche de Mots / Musique / Date et Temps /
 *       Télécommunication / Internet / Traitement de Texte，共 264 个工具条目。
 *
 * 纪律：
 * - 只做纯 JS、可复现的确定性核心；图片/OCR/音频/条码/外部 DNS/运营商库不伪造，台账标 blocked。
 * - 词类求解器优先用输入中 `===` 之后自带的词表，其次用插件内置 EN/FR 词典；
 *   找不到词表时显式报错，不生成假词。
 * - 所有搜索有界（节点/结果/时间上限），超限显式报错。
 * - 每个 op 在 tests/auto-d3.selftest.mjs 中有已知向量/往返断言。
 */

import { runOp, parseList, parseNums, randInt } from "../lib/util.js";

const CAT_GAME = "dcode-extras-2026-10/cat-game";
const CAT_NUM = "dcode-extras-2026-10/cat-numeral";
const CAT_TEXT = "dcode-extras-2026-10/cat-text";

const P = (key, label, ph) => ({ key, label, type: "text", default: "", placeholder: ph || "" });
const SEL = (key, label, def, opts) => ({ key, label, type: "select", default: def, options: opts.map((o) => (typeof o === "string" ? { value: o, label: o } : o)) });

// ---------- 内置词典（与 lexicon2.js 同一份纯文本，独立缓存；===' 之后的自带词表优先） ----------
const LEX = { en: [], fr: [] };
function splitLines(text) {
  return String(text).split(/\r?\n/).map((w) => w.trim().toLowerCase()).filter((w) => w && !w.startsWith("#"));
}
try {
  if (typeof process !== "undefined" && typeof process.getBuiltinModule === "function") {
    const fs = process.getBuiltinModule("node:fs");
    for (const lang of ["en", "fr"]) {
      const p = new URL(`../data/lexicon-${lang}.txt`, import.meta.url);
      LEX[lang] = splitLines(fs.readFileSync(p, "utf8"));
    }
  }
} catch { /* 浏览器或文件缺失时走 fetch */ }
if (!LEX.en.length && typeof fetch === "function") {
  try {
    const [en, fr] = await Promise.all(["en", "fr"].map(async (lang) => {
      const res = await fetch(new URL(`../data/lexicon-${lang}.txt`, import.meta.url));
      if (!res.ok) throw new Error(String(res.status));
      return res.text();
    }));
    LEX.en = splitLines(en);
    LEX.fr = splitLines(fr);
  } catch { /* 保持空；使用词表的 op 会给出明确错误 */ }
}

function dict(lang, provided) {
  if (provided && provided.length) return provided;
  const arr = LEX[lang === "fr" ? "fr" : "en"];
  if (!arr.length) throw new Error("内置词典未加载：请在输入中用单独一行 === 分隔，并在其后提供词表（每行一词）");
  return arr;
}

function splitDoc(text) {
  const s = String(text == null ? "" : text);
  const parts = s.split(/^\s*={3,}\s*$/m);
  if (parts.length === 1) return { main: s.trim(), words: null };
  return { main: parts[0].trim(), words: parseList(parts.slice(1).join("\n")).map((w) => w.toLowerCase()) };
}

function gridRows(main) {
  return String(main).split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((r) => r.replace(/[\s,]+/g, "").toUpperCase());
}

function sortLetters(w) {
  return [...w].sort().join("");
}

function bagOf(s) {
  const m = new Map();
  for (const c of s) m.set(c, (m.get(c) || 0) + 1);
  return m;
}

function canMake(word, bag, wilds) {
  const need = bagOf(word);
  let short = 0;
  for (const [c, n] of need) {
    const d = (bag.get(c) || 0) - n;
    if (d < 0) short += -d;
  }
  return short <= wilds;
}

const A26 = "abcdefghijklmnopqrstuvwxyz";
const VOWELS = /[aeiouyàâäéèêëîïôöùûüÿœæ]/i;

// =====================================================================================
// 1. Boggle / 网格路径词
// =====================================================================================
const opBoggle = runOp(
  "d3-boggle", CAT_GAME,
  "Boggle 网格搜词（4×4 / 5×5 / 6×6 / n×n）",
  "字母网格沿 8 邻接、不可重复用格搜词。内置 EN/FR 词典，或输入中 === 后自带词表。覆盖 Boggle 4×4、Big Boggle 5×5、Super Big Boggle 6×6、Boggle n×n、Squaredle、Word Hunt、Wordament、Ruzzle、Word Streak、Word Blitz、WordBrain 等路径规则；词表决定结果，不内置谜题答案",
  (t, p) => {
    const { main, words } = splitDoc(t);
    const rows = gridRows(main);
    const R = rows.length, C = rows[0] ? rows[0].length : 0;
    if (R < 2 || C < 2 || R * C > 64 || !rows.every((r) => r.length === C)) throw new Error("网格需 2..8 行、行长一致、总格 ≤64");
    const min = Math.max(2, Math.min(6, Number((p && p.min) || 3) || 3));
    const lang = String((p && p.lang) || "en");
    const list = dict(lang, words).filter((w) => w.length >= min && w.length <= R * C && /^[a-zà-ÿ]+$/.test(w));
    if (!list.length) throw new Error("词表为空或不含 ≥" + min + " 字母的纯字母词");
    const trie = new Map();
    for (const w of list) {
      let node = trie;
      for (const ch of w) {
        if (!node.has(ch)) node.set(ch, new Map());
        node = node.get(ch);
      }
      node.set("$", w);
    }
    const found = new Set();
    let nodes = 0;
    const dirs = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
    const used = new Uint8Array(R * C);
    const rec = (r, c, node) => {
      const next = node.get(rows[r][c].toLowerCase());
      if (!next) return;
      if (++nodes > 2e6) throw new Error("路径搜索超 2e6 节点，请减小网格或词表");
      const idx = r * C + c;
      used[idx] = 1;
      if (next.has("$")) found.add(next.get("$"));
      for (const [dr, dc] of dirs) {
        const nr = r + dr, nc = c + dc;
        if (nr < 0 || nc < 0 || nr >= R || nc >= C || used[nr * C + nc]) continue;
        rec(nr, nc, next);
      }
      used[idx] = 0;
    };
    for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) rec(r, c, trie);
    const out = [...found].sort((a, b) => b.length - a.length || a.localeCompare(b));
    return `网格 ${R}×${C} 找到 ${out.length} 词（词表 ${list.length}）：\n` + (out.length ? out.map((w) => `${w} (${w.length})`).join("\n") : "（无）");
  },
  [P("lang", "词典（en/fr）", "en"), P("min", "最短词长 2..6", "3")]
);

// =====================================================================================
// 2. 字母架找词（Word Cookies / Wordscapes 等）
// =====================================================================================
const opWordfind = runOp(
  "d3-wordfind", CAT_GAME,
  "字母架找词（Word Cookies / Wordscapes / Wordington…）",
  "给定字母架（? 为通配）与可选目标长度，列可拼词并按长度分组。内置 EN/FR 词典，或 === 后自带词表。覆盖 Word Cookies、Wordscapes、Wordington、Wordalot、Word Cross、Word Snack、Word Academy、WordBubbles、Jardin des Mots、Maître des Mots、Charme des Mots、Pro des Mots、Wordox、Word Bites 等『给字母找词』核心",
  (t, p) => {
    const { main, words } = splitDoc(t);
    const lines = main.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
    if (!lines.length) throw new Error("第一行给字母架，第二行可选给目标长度（如 4,6）");
    const rack = lines[0].toLowerCase().replace(/[^a-zà-ÿ?]/g, "");
    if (rack.length < 2 || rack.length > 15) throw new Error("字母架需 2..15 个字母（? 通配）");
    const wilds = [...rack].filter((c) => c === "?").length;
    if (wilds > 2) throw new Error("通配最多 2 个（防爆炸）");
    const bag = bagOf(rack.replace(/\?/g, ""));
    const lens = lines[1] ? lines[1].split(/[,\s]+/).map(Number).filter((n) => Number.isInteger(n) && n > 0) : [];
    const lang = String((p && p.lang) || "en");
    const list = dict(lang, words);
    const hits = [];
    for (const w of list) {
      if (w.length < 2 || w.length > rack.length) continue;
      if (lens.length && !lens.includes(w.length)) continue;
      if (!/^[a-zà-ÿ]+$/.test(w)) continue;
      if (canMake(w, bag, wilds)) {
        hits.push(w);
        if (hits.length > 200000) throw new Error("命中过多，请减少通配或指定长度");
      }
    }
    if (!hits.length) return `字母架「${rack}」在词表中无可拼词`;
    const groups = new Map();
    for (const w of hits) {
      if (!groups.has(w.length)) groups.set(w.length, []);
      groups.get(w.length).push(w);
    }
    const out = [...groups.keys()].sort((a, b) => a - b).map((n) => `${n} 字母（${groups.get(n).length}）：${groups.get(n).sort().join(" ")}`);
    return `字母架「${rack}」命中 ${hits.length} 词：\n` + out.join("\n");
  },
  [P("lang", "词典（en/fr）", "en")]
);

// =====================================================================================
// 3. Spelling Bee / Blossom
// =====================================================================================
const opSpellingbee = runOp(
  "d3-spellingbee", CAT_GAME,
  "Spelling Bee / Blossom（中心字母必用）",
  "7 个字母（中心字母默认第一个）中找长度 ≥4 的词：必须含中心字母、只能用给定字母；标出全字母 pangram。内置 EN/FR 词典或 === 后词表。Spelling Bee 与 Blossom 共用此规则",
  (t, p) => {
    const { main, words } = splitDoc(t);
    const lettersLine = main.split(/\r?\n/).map((x) => x.trim()).filter(Boolean)[0] || "";
    const letters = [...new Set(lettersLine.toLowerCase().replace(/[^a-zà-ÿ]/g, ""))];
    if (letters.length < 3 || letters.length > 12) throw new Error("给 3..12 个不同字母（中心字母默认第一个）");
    const center = String((p && p.center) || letters[0]).toLowerCase().replace(/[^a-zà-ÿ]/g, "");
    if (center.length !== 1 || !letters.includes(center)) throw new Error("中心字母必须在字母集中");
    const allowed = new Set(letters);
    const lang = String((p && p.lang) || "en");
    const list = dict(lang, words);
    const hits = [];
    for (const w of list) {
      if (w.length < 4 || !/^[a-zà-ÿ]+$/.test(w)) continue;
      if (!w.includes(center)) continue;
      let ok = true;
      for (const c of w) if (!allowed.has(c)) { ok = false; break; }
      if (!ok) continue;
      const pangram = letters.every((c) => w.includes(c));
      const score = (w.length === 4 ? 1 : w.length) + (pangram ? 7 : 0);
      hits.push({ w, pangram, score });
    }
    hits.sort((a, b) => b.score - a.score || a.w.localeCompare(b.w));
    if (hits.length > 2000) throw new Error("命中超过 2000，请缩小词表");
    return `中心「${center}」，字母 {${letters.join("")}}：${hits.length} 词，共 ${hits.reduce((a, b) => a + b.score, 0)} 分\n` +
      (hits.length ? hits.map((x) => `${x.score}\t${x.w}${x.pangram ? "\t【全字母】" : ""}`).join("\n") : "（无）");
  },
  [P("center", "中心字母（默认第一个）", ""), P("lang", "词典（en/fr）", "en")]
);

// =====================================================================================
// 4. Letter Boxed
// =====================================================================================
function sideOf(sides, ch) {
  for (let i = 0; i < sides.length; i++) if (sides[i].includes(ch)) return i;
  return -1;
}
const opLetterboxed = runOp(
  "d3-letterboxed", CAT_GAME,
  "Letter Boxed 链条求解",
  "四边字母（每边 ≥2 个）中找词：相邻字母必须来自不同边；词链首尾相接并覆盖全部字母。内置词典或 === 后词表；BFS 有界给最短链",
  (t, p) => {
    const { main, words } = splitDoc(t);
    const first = main.split(/\r?\n/).map((x) => x.trim()).filter(Boolean)[0] || "";
    const sides = first.split(/[\s,;/]+/).filter(Boolean).map((s) => [...new Set(s.toLowerCase().replace(/[^a-zà-ÿ]/g, ""))]);
    if (sides.length !== 4 || sides.some((s) => s.length < 2)) throw new Error("第一行给四边字母，如 abcd efgh ijkl mnop（每边 ≥2 个）");
    const allowedLetters = [...new Set(sides.flat())];
    if (allowedLetters.length > 16) throw new Error("字母总数需 ≤16（位掩码上限）");
    const letterIndex = new Map(allowedLetters.map((c, i) => [c, i]));
    const fullMask = (1 << allowedLetters.length) - 1;
    const lang = String((p && p.lang) || "en");
    const list = dict(lang, words).filter((w) => w.length >= 3 && /^[a-zà-ÿ]+$/.test(w));
    const wordsOk = [];
    for (const w of list) {
      let ok = true, prev = -1;
      for (const c of w) {
        const s = sideOf(sides, c);
        if (s < 0 || s === prev) { ok = false; break; }
        prev = s;
      }
      if (ok) wordsOk.push(w);
      if (wordsOk.length > 5000) throw new Error("合法词超过 5000，请缩小词表");
    }
    if (!wordsOk.length) return "词表中没有满足『相邻字母不同边』的词";
    const byFirst = new Map();
    for (const w of wordsOk) {
      if (!byFirst.has(w[0])) byFirst.set(w[0], []);
      byFirst.get(w[0]).push(w);
    }
    const cover = (w) => {
      let m = 0;
      for (const c of w) m |= 1 << letterIndex.get(c);
      return m;
    };
    let best = null;
    for (const w of wordsOk) {
      const start = { last: w[w.length - 1], mask: cover(w), chain: [w] };
      const q = [start];
      const seen = new Set([`${start.last}|${start.mask}`]);
      let guard = 0;
      while (q.length) {
        if (++guard > 50000) throw new Error("链搜索超 50000 状态");
        const cur = q.shift();
        if (cur.mask === fullMask) { if (!best || cur.chain.length < best.length) best = cur.chain; break; }
        if (cur.chain.length >= 8) continue;
        for (const nw of byFirst.get(cur.last) || []) {
          const nm = cur.mask | cover(nw);
          const key = `${nw[nw.length - 1]}|${nm}`;
          if (seen.has(key)) continue;
          seen.add(key);
          q.push({ last: nw[nw.length - 1], mask: nm, chain: [...cur.chain, nw] });
        }
      }
      if (best && best.length <= 2) break;
    }
    if (!best) return `没有 ≤8 词的链能覆盖全部 ${allowedLetters.length} 个字母（合法词 ${wordsOk.length} 个）`;
    return `最短链 ${best.length} 词：\n${best.join(" → ")}\n覆盖 ${allowedLetters.length}/${allowedLetters.length} 字母`;
  },
  [P("lang", "词典（en/fr）", "en")]
);

// =====================================================================================
// 5. 加/删/改/延长一个字母
// =====================================================================================
const opWordextend = runOp(
  "d3-wordextend", CAT_GAME,
  "字母增删改 / 延长词（Ajouter / Retirer / Changer / Prolonger）",
  "在单词上插入一个字母、删除一个字母、替换一个字母，或找以该词开头/结尾的更长词。内置词典或 === 后词表；覆盖 dCode 的四个字母变换工具",
  (t, p) => {
    const { main, words } = splitDoc(t);
    const word = (main.split(/\r?\n/).map((x) => x.trim()).filter(Boolean)[0] || "").toLowerCase().replace(/[^a-zà-ÿ]/g, "");
    if (word.length < 2) throw new Error("第一行给一个 ≥2 字母的单词");
    const mode = String((p && p.mode) || "add");
    const lang = String((p && p.lang) || "en");
    const set = new Set(dict(lang, words));
    const out = new Set();
    if (mode === "add" || mode === "insert") {
      for (let i = 0; i <= word.length; i++) for (const c of A26) {
        const cand = word.slice(0, i) + c + word.slice(i);
        if (set.has(cand)) out.add(cand);
      }
    } else if (mode === "remove") {
      for (let i = 0; i < word.length; i++) {
        const cand = word.slice(0, i) + word.slice(i + 1);
        if (set.has(cand)) out.add(cand);
      }
    } else if (mode === "change") {
      for (let i = 0; i < word.length; i++) for (const c of A26) {
        if (c === word[i]) continue;
        const cand = word.slice(0, i) + c + word.slice(i + 1);
        if (set.has(cand)) out.add(cand);
      }
    } else if (mode === "extend") {
      for (const w of set) {
        if (w.length > word.length && (w.startsWith(word) || w.endsWith(word))) out.add(w);
      }
    } else throw new Error(`未知模式 ${mode}`);
    const arr = [...out].sort();
    return arr.length ? `${word}（${mode}）${arr.length} 个：\n${arr.join("\n")}` : `${word}（${mode}）在词表中无结果`;
  },
  [SEL("mode", "模式", "add", [{ value: "add", label: "插入一个字母" }, { value: "remove", label: "删除一个字母" }, { value: "change", label: "替换一个字母" }, { value: "extend", label: "延长（前缀/后缀）" }]), P("lang", "词典（en/fr）", "en")]
);

// =====================================================================================
// 6. Anacycliques
// =====================================================================================
const opAnacyclic = runOp(
  "d3-anacyclic", CAT_GAME,
  "Anacyclique（反转成另一词）",
  "找词典中互为倒序的两个不同单词（dog ↔ god）；回文词不计。内置词典或 === 后词表",
  (t, p) => {
    const { main, words } = splitDoc(t);
    const lang = String((p && p.lang) || "en");
    const min = Math.max(2, Number((p && p.min) || 2) || 2);
    const list = dict(lang, words);
    const set = new Set(list.filter((w) => w.length >= min && /^[a-zà-ÿ]+$/.test(w)));
    const out = [];
    for (const w of set) {
      const r = [...w].reverse().join("");
      if (r !== w && set.has(r) && w < r) out.push(`${w} ↔ ${r}`);
    }
    out.sort();
    const head = main ? `（忽略输入首段「${main.slice(0, 40)}」，以词典为准）\n` : "";
    return out.length ? `${head}找到 ${out.length} 对 anacyclique：\n${out.join("\n")}` : `${head}词表中没有互为倒序的不同词`;
  },
  [P("lang", "词典（en/fr）", "en"), P("min", "最短长度", "2")]
);

// =====================================================================================
// 7. 单词金字塔（逐级加一字母）
// =====================================================================================
const opWordpyramid = runOp(
  "d3-wordpyramid", CAT_GAME,
  "单词金字塔（每级加一个字母）",
  "从种子词出发，每级加一个字母并重组为词典中的下一个词（a → at → cat → cart）。内置词典或 === 后词表；DFS 有界",
  (t, p) => {
    const { main, words } = splitDoc(t);
    const seed = (main.split(/\r?\n/).map((x) => x.trim()).filter(Boolean)[0] || "").toLowerCase().replace(/[^a-zà-ÿ]/g, "");
    if (seed.length < 1) throw new Error("第一行给种子词（1..8 字母）");
    const target = Math.max(seed.length + 1, Number((p && p.target) || 5) || 5);
    if (target > 10) throw new Error("目标长度 ≤10");
    const lang = String((p && p.lang) || "en");
    const list = dict(lang, words).filter((w) => /^[a-zà-ÿ]+$/.test(w) && w.length >= seed.length && w.length <= target);
    const set = new Set(list);
    if (!set.has(seed) && seed.length > 1) return `种子词「${seed}」不在词表中`;
    const byKey = new Map();
    for (const w of list) {
      const k = `${w.length}|${sortLetters(w)}`;
      if (!byKey.has(k)) byKey.set(k, []);
      byKey.get(k).push(w);
    }
    let nodes = 0;
    const rec = (word, chain) => {
      if (++nodes > 200000) throw new Error("金字塔搜索超 20 万节点");
      if (chain.length === target) return chain;
      const key = sortLetters(word);
      const seenKeys = new Set();
      for (let i = 0; i <= key.length; i++) for (const c of A26) {
        const nk = key.slice(0, i) + c + key.slice(i);
        if (seenKeys.has(nk)) continue;
        seenKeys.add(nk);
        const cands = byKey.get(`${word.length + 1}|${nk}`) || [];
        for (const cand of cands) {
          if (chain.includes(cand)) continue;
          const r = rec(cand, [...chain, cand]);
          if (r) return r;
        }
      }
      return null;
    };
    const path = rec(seed, [seed]);
    return path ? `金字塔（${path.length} 级）：\n${path.join(" → ")}` : `从「${seed}」到 ${target} 字母没有找到逐级加一字母的词链`;
  },
  [P("target", "目标长度", "5"), P("lang", "词典（en/fr）", "en")]
);

// =====================================================================================
// 8. 缺元音 / 缺辅音
// =====================================================================================
const opMissingletters = runOp(
  "d3-missingletters", CAT_GAME,
  "缺元音 / 缺辅音（Consonnes / Voyelles Manquantes）",
  "把词表中的词删去全部元音（或辅音）后与输入骨架匹配，找回候选词。例如骨架 ct → cat/cot/cut",
  (t, p) => {
    const { main, words } = splitDoc(t);
    const pat = (main.split(/\r?\n/).map((x) => x.trim()).filter(Boolean)[0] || "").toLowerCase().replace(/[^a-zà-ÿ]/g, "");
    if (!pat) throw new Error("第一行给缺字母后的骨架，如 ct");
    const mode = String((p && p.mode) || "vowels");
    const lang = String((p && p.lang) || "en");
    const strip = (w) => [...w].filter((c) => (mode === "vowels" ? !VOWELS.test(c) : VOWELS.test(c))).join("");
    const hits = [];
    for (const w of dict(lang, words)) {
      if (!/^[a-zà-ÿ]+$/.test(w)) continue;
      if (strip(w) === pat) hits.push(w);
      if (hits.length > 2000) throw new Error("命中超过 2000，请缩小词表");
    }
    return hits.length ? `骨架「${pat}」（缺${mode === "vowels" ? "元音" : "辅音"}）候选 ${hits.length} 个：\n${hits.sort().join("\n")}` : `骨架「${pat}」在词表中无候选`;
  },
  [SEL("mode", "缺哪类", "vowels", [{ value: "vowels", label: "缺元音" }, { value: "consonants", label: "缺辅音" }]), P("lang", "词典（en/fr）", "en")]
);

// =====================================================================================
// 9. 词模式 / 正则检索
// =====================================================================================
const opWordregex = runOp(
  "d3-wordregex", CAT_GAME,
  "词检索（通配 / 正则）",
  "在词典中按通配（* 任意长、? 单字符）或正则检索。覆盖 Recherche de Mot、Motif、Regex 与 Mots Commençant/Contenant/Finissant；结果上限 500，正则模式带 2 秒时间上限",
  (t, p) => {
    const { main, words } = splitDoc(t);
    const pat = main.split(/\r?\n/).map((x) => x.trim()).filter(Boolean)[0] || "";
    if (!pat || pat.length > 120) throw new Error("第一行给 ≤120 字符的模式");
    const mode = String((p && p.mode) || "glob");
    const lang = String((p && p.lang) || "en");
    let re;
    if (mode === "regex") {
      if (/\([^)]*[+*][^)]*\)[+*{]/.test(pat)) throw new Error("拒绝嵌套量词（防灾难性回溯）");
      try { re = new RegExp(`^(?:${pat})$`, "i"); } catch (e) { throw new Error("正则无效：" + (e && e.message ? e.message : e)); }
    } else {
      let g = "^";
      for (const ch of pat) {
        if (ch === "*") g += ".*";
        else if (ch === "?") g += ".";
        else g += ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      }
      re = new RegExp(g + "$", "i");
    }
    const hits = [];
    const started = Date.now();
    let scanned = 0;
    for (const w of dict(lang, words)) {
      if (++scanned % 5000 === 0 && Date.now() - started > 2000) throw new Error("正则检索超 2 秒，请缩小词表或简化模式");
      if (re.test(w)) {
        hits.push(w);
        if (hits.length >= 500) break;
      }
    }
    return hits.length ? `模式「${pat}」（${mode}）命中 ${hits.length >= 500 ? "≥500（截断）" : hits.length}：\n${hits.join("\n")}` : `模式「${pat}」在词表中无命中`;
  },
  [SEL("mode", "模式", "glob", [{ value: "glob", label: "通配 * ?" }, { value: "regex", label: "正则" }]), P("lang", "词典（en/fr）", "en")]
);

// =====================================================================================
// 10. 前一个 / 后一个词
// =====================================================================================
const opWordorder = runOp(
  "d3-wordorder", CAT_GAME,
  "词典前词 / 后词（Mot Précédent / Suivant）",
  "按词典排序给出给定词的前一个、后一个词；词不在词典时给出插入位置两侧。内置词典或 === 后词表",
  (t, p) => {
    const { main, words } = splitDoc(t);
    const word = (main.split(/\r?\n/).map((x) => x.trim()).filter(Boolean)[0] || "").toLowerCase();
    if (!word) throw new Error("第一行给一个词");
    const lang = String((p && p.lang) || "en");
    const sorted = [...new Set(dict(lang, words).filter((w) => /^[a-zà-ÿ]+$/.test(w)))].sort();
    let lo = 0, hi = sorted.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (sorted[mid] < word) lo = mid + 1; else hi = mid; }
    const exact = sorted[lo] === word;
    const prev = exact ? sorted[lo - 1] : sorted[lo - 1];
    const next = exact ? sorted[lo + 1] : sorted[lo];
    return `词「${word}」${exact ? "在" : "不在"}词典（第 ${exact ? lo + 1 : lo + 1} 位）\n前一个：${prev || "（无）"}\n后一个：${next || "（无）"}`;
  },
  [P("lang", "词典（en/fr）", "en")]
);

// =====================================================================================
// 11. Jotto
// =====================================================================================
function commonCount(a, b) {
  const ba = bagOf(a), bb = bagOf(b);
  let n = 0;
  for (const [c, k] of ba) n += Math.min(k, bb.get(c) || 0);
  return n;
}
const opJotto = runOp(
  "d3-jotto", CAT_GAME,
  "Jotto 候选过滤",
  "历史猜测格式『词:共同字母数』每行一条；按多重集交集计数过滤等长候选词。内置词典或 === 后词表",
  (t, p) => {
    const { main, words } = splitDoc(t);
    const lines = main.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
    if (!lines.length) throw new Error("每行一条『crane:3』");
    const hist = lines.map((l) => {
      const m = l.replace(/\s/g, "").match(/^([a-zà-ÿ]+):(\d+)$/i);
      if (!m) throw new Error(`行「${l}」格式应为 词:数字`);
      return { g: m[1].toLowerCase(), n: Number(m[2]) };
    });
    const L = hist[0].g.length;
    const lang = String((p && p.lang) || "en");
    const hits = [];
    for (const w of dict(lang, words)) {
      if (w.length !== L || !/^[a-zà-ÿ]+$/.test(w)) continue;
      if (hist.every((h) => commonCount(w, h.g) === h.n)) {
        hits.push(w);
        if (hits.length > 5000) throw new Error("候选超过 5000，请再加反馈");
      }
    }
    return hits.length ? `一致候选 ${hits.length} 个：\n${hits.slice(0, 500).join("\n")}${hits.length > 500 ? "\n…（截断到 500）" : ""}` : "无候选（反馈矛盾或词表缺失）";
  },
  [P("lang", "词典（en/fr）", "en")]
);

// =====================================================================================
// 12. Motus / Sutom / Tusmo
// =====================================================================================
function wordleScore(guess, word) {
  const n = guess.length;
  const res = new Array(n).fill(".");
  const rest = new Map();
  for (let i = 0; i < n; i++) {
    if (guess[i] === word[i]) res[i] = "G";
    else rest.set(word[i], (rest.get(word[i]) || 0) + 1);
  }
  for (let i = 0; i < n; i++) {
    if (res[i] === "G") continue;
    const c = guess[i];
    const k = rest.get(c) || 0;
    if (k > 0) { res[i] = "Y"; rest.set(c, k - 1); }
  }
  return res.join("");
}
const opMotus = runOp(
  "d3-motus", CAT_GAME,
  "Motus / Sutom / Tusmo 候选过滤",
  "第一行『长度 首字母』（如 5 c），随后每行『猜测:反馈』；G=位置对、Y=字母在但位置错、.=不在。内置词典或 === 后词表",
  (t, p) => {
    const { main, words } = splitDoc(t);
    const lines = main.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
    if (!lines.length) throw new Error("第一行给『长度 首字母』，如 5 c");
    const hm = lines[0].match(/^(\d+)\s+([a-zà-ÿ])$/i);
    if (!hm) throw new Error("首行格式应为『5 c』");
    const L = Number(hm[1]);
    if (!Number.isInteger(L) || L < 2 || L > 15) throw new Error("长度需 2..15");
    const first = hm[2].toLowerCase();
    if (lines.length < 2) throw new Error("至少给一行『猜测:反馈』");
    const hist = lines.slice(1).map((l) => {
      const m = l.replace(/\s/g, "").match(/^([a-zà-ÿ]+):([GY.]+)$/i);
      if (!m) throw new Error(`反馈行「${l}」格式应为 crane:G.Y..`);
      if (m[1].length !== L || m[2].length !== L) throw new Error(`「${l}」长度应为 ${L}`);
      return { g: m[1].toLowerCase(), f: m[2].toUpperCase() };
    });
    const lang = String((p && p.lang) || "en");
    const hits = [];
    for (const w of dict(lang, words)) {
      if (w.length !== L || w[0] !== first || !/^[a-zà-ÿ]+$/.test(w)) continue;
      if (hist.every((h) => wordleScore(h.g, w) === h.f)) {
        hits.push(w);
        if (hits.length > 5000) throw new Error("候选超过 5000，请再加反馈");
      }
    }
    return hits.length ? `一致候选 ${hits.length} 个：\n${hits.slice(0, 500).join("\n")}${hits.length > 500 ? "\n…（截断到 500）" : ""}` : "无候选（反馈矛盾或词表缺失）";
  },
  [P("lang", "词典（en/fr）", "en")]
);

// =====================================================================================
// 13. 短语 / 轮盘（Wheel of Fortune / What's the Phrase）
// =====================================================================================
const opPhrasefilter = runOp(
  "d3-phrasefilter", CAT_GAME,
  "短语模式过滤（Roue de la Fortune / What's the Phrase）",
  "按字母模式过滤候选短语：_ 或 . 表示未知，空格和标点原样匹配，大小写不敏感。词库需在 === 后自带（不内置影视/节目短语库）",
  (t, p) => {
    const { main, words } = splitDoc(t);
    const pat = main.split(/\r?\n/).map((x) => x.trim()).filter(Boolean)[0] || "";
    if (!pat) throw new Error("第一行给短语模式，如 HELLO W____");
    if (!words || !words.length) throw new Error("短语库需在 === 后提供（每行一条），本 op 不内置节目答案库");
    let re = "^";
    for (const ch of pat) {
      if (ch === "_" || ch === "." || ch === "?") re += ".";
      else if (/\s/.test(ch)) re += "\\s+";
      else re += ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
    re += "$";
    const rx = new RegExp(re, "i");
    const hits = words.filter((w) => rx.test(w));
    return hits.length ? `模式「${pat}」候选 ${hits.length} 条：\n${hits.slice(0, 500).join("\n")}` : `模式「${pat}」无候选`;
  }
);

// =====================================================================================
// 14. 找词网格（Mots-Mêlés / Nombres Mêlés）
// =====================================================================================
const opWordsearch = runOp(
  "d3-wordsearch", CAT_GAME,
  "找词网格（Mots-Mêlés / Nombres Mêlés）",
  "在字母/数字网格中沿 8 方向找给定词。输入：网格每行一项，=== 后每行一个待找词；输出起止坐标与方向",
  (t) => {
    const { main, words } = splitDoc(t);
    const rows = gridRows(main);
    const R = rows.length, C = rows[0] ? rows[0].length : 0;
    if (R < 2 || C < 2 || R * C > 400 || !rows.every((r) => r.length === C)) throw new Error("网格需 2..20 行、行长一致、总格 ≤400");
    if (!words || !words.length) throw new Error("=== 后给待找词（每行一个）");
    const dirs = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
    const arrows = ["↖", "↑", "↗", "←", "→", "↙", "↓", "↘"];
    const out = [];
    for (const raw of words) {
      const w = String(raw).toUpperCase().replace(/[^0-9A-ZÀ-Ÿ]/g, "");
      if (w.length < 2) continue;
      let found = null;
      for (let r = 0; r < R && !found; r++) for (let c = 0; c < C && !found; c++) {
        for (let d = 0; d < 8 && !found; d++) {
          const [dr, dc] = dirs[d];
          let ok = true;
          for (let k = 0; k < w.length; k++) {
            const nr = r + dr * k, nc = c + dc * k;
            if (nr < 0 || nc < 0 || nr >= R || nc >= C || rows[nr][nc] !== w[k]) { ok = false; break; }
          }
          if (ok) found = `${w}: (${r + 1},${c + 1}) → (${r + dr * (w.length - 1) + 1},${c + dc * (w.length - 1) + 1}) ${arrows[d]}`;
        }
      }
      out.push(found || `${w}: 未找到`);
    }
    return `网格 ${R}×${C}：\n${out.join("\n")}`;
  }
);

// =====================================================================================
// 15. 变位词全排列生成
// =====================================================================================
const opAnagramGen = runOp(
  "d3-anagram-gen", CAT_GAME,
  "变位词生成（Générateur d'Anagrammes）",
  "给 ≤8 个字母，生成全部不重复排列；=== 后给词表时只保留词表中的词。有界 8! = 40320",
  (t) => {
    const { main, words } = splitDoc(t);
    const letters = [...(main.split(/\r?\n/).map((x) => x.trim()).filter(Boolean)[0] || "").toLowerCase().replace(/[^a-zà-ÿ]/g, "")];
    if (letters.length < 2 || letters.length > 8) throw new Error("字母数需 2..8（全排列上限 40320）");
    const set = words && words.length ? new Set(words) : null;
    const out = new Set();
    const used = new Array(letters.length).fill(false);
    const rec = (s) => {
      if (s.length === letters.length) { if (!set || set.has(s)) out.add(s); return; }
      for (let i = 0; i < letters.length; i++) {
        if (used[i]) continue;
        used[i] = true; rec(s + letters[i]); used[i] = false;
      }
    };
    rec("");
    const arr = [...out].sort();
    return `字母「${letters.join("")}」${set ? "词表内" : ""}变位词 ${arr.length} 个：\n${arr.join("\n") || "（无）"}`;
  }
);

// =====================================================================================
// 16. 回文生成
// =====================================================================================
const opPalindromeGen = runOp(
  "d3-palindrome-gen", CAT_GAME,
  "回文生成（Générateur de Palindromes）",
  "把输入镜像成回文：字符模式 s+reverse(s)，词模式按词倒序；确定性输出，可用于构造回文串",
  (t, p) => {
    const mode = String((p && p.mode) || "char");
    const s = String(t).trim();
    if (!s) throw new Error("需要非空文本");
    if (mode === "word") {
      const words = s.split(/\s+/).filter(Boolean);
      return [...words, ...[...words].reverse()].join(" ");
    }
    return s + [...s].reverse().join("");
  },
  [SEL("mode", "模式", "char", [{ value: "char", label: "字符镜像" }, { value: "word", label: "词序镜像" }])]
);

// =====================================================================================
// 17. 随机：字母/数字/数/词/扑克牌/抽签/假名
// =====================================================================================
const FAKE_ADJ = ["vif", "sombre", "lunaire", "solaire", "ancien", "nouveau", "rouge", "bleu", "silencieux", "rapide"];
const FAKE_NOUN = ["renard", "corbeau", "tigre", "comete", "jardin", "miroir", "oracle", "passage", "atelier", "rivage"];
const opRandom = runOp(
  "d3-random", CAT_TEXT,
  "随机生成（字母/数字/数/词/牌/抽签/假名）",
  "统一随机源：随机字母、随机数字串、随机整数、随机词（词典或自带词表）、52 张扑克牌/发牌、列表抽签、随机假名。覆盖 Lettre/Mot/Chiffres/Nombres Aléatoires、Carte à Jouer、Tirage au Sort、Générateur de Pseudo 等",
  (t, p) => {
    const mode = String((p && p.mode) || "letter");
    const n = Math.max(1, Math.min(1000, Number((p && p.n) || 1) || 1));
    const { main, words } = splitDoc(t);
    const list = words && words.length ? words : (main ? parseList(main) : null);
    if (mode === "letter") {
      let out = "";
      for (let i = 0; i < n; i++) out += A26[randInt(26)].toUpperCase();
      return out;
    }
    if (mode === "digits") {
      let out = "";
      for (let i = 0; i < n; i++) out += String(randInt(10));
      return out;
    }
    if (mode === "numbers") {
      const min = Number((p && p.min) || 1) || 1;
      const max = Number((p && p.max) || 100) || 100;
      if (!Number.isFinite(min) || !Number.isFinite(max) || max < min) throw new Error("需要 min ≤ max");
      const span = Math.floor(max) - Math.ceil(min) + 1;
      if (span < 1 || span > 2 ** 31 - 1) throw new Error("范围需在 2^31 内");
      return Array.from({ length: n }, () => String(Math.ceil(min) + randInt(span))).join(" ");
    }
    if (mode === "word") {
      const lang = String((p && p.lang) || "en");
      const arr = (list && list.length ? list : dict(lang, null)).filter((w) => /^[a-zà-ÿ]+$/.test(w));
      if (!arr.length) throw new Error("无可用词表");
      const out = [];
      for (let i = 0; i < n; i++) out.push(arr[randInt(arr.length)]);
      return out.join("\n");
    }
    if (mode === "card" || mode === "deck") {
      const ranks = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "V", "D", "R", "A"];
      const suits = ["♠", "♥", "♦", "♣"];
      const deck = [];
      for (const s of suits) for (const r of ranks) deck.push(r + s);
      if (mode === "deck") return `52 张牌：\n${deck.join(" ")}`;
      if (n > 52) throw new Error("最多发 52 张");
      const picked = [];
      const used = new Set();
      while (picked.length < n) {
        const i = randInt(52);
        if (used.has(i)) continue;
        used.add(i); picked.push(deck[i]);
      }
      return picked.join(" ");
    }
    if (mode === "draw") {
      if (!list || !list.length) throw new Error("抽签需要 === 后或输入中的候选列表（每行一项）");
      if (n > list.length) throw new Error(`抽取个数需 ≤ ${list.length}`);
      const arr = list.slice();
      for (let i = arr.length - 1; i > 0; i--) { const j = randInt(i + 1); [arr[i], arr[j]] = [arr[j], arr[i]]; }
      return arr.slice(0, n).join("\n");
    }
    if (mode === "pseudo") {
      const out = [];
      for (let i = 0; i < n; i++) out.push(FAKE_ADJ[randInt(FAKE_ADJ.length)] + FAKE_NOUN[randInt(FAKE_NOUN.length)] + randInt(100));
      return out.join("\n");
    }
    throw new Error(`未知模式 ${mode}`);
  },
  [SEL("mode", "模式", "letter", [{ value: "letter", label: "随机字母" }, { value: "digits", label: "随机数字串" }, { value: "numbers", label: "随机整数" }, { value: "word", label: "随机词" }, { value: "card", label: "随机扑克牌" }, { value: "deck", label: "整副 52 张" }, { value: "draw", label: "列表抽签" }, { value: "pseudo", label: "随机假名" }]), P("n", "数量", "1"), P("min", "整数下限", "1"), P("max", "整数上限", "100"), P("lang", "词典（en/fr）", "en")]
);

// =====================================================================================
// 17b. 扑克牌参考表（名称/人物/缩写/Unicode）
// =====================================================================================
const CARD_SUITS = [
  { sym: "♠", fr: "Pique", en: "Spades", color: "黑", letter: "P" },
  { sym: "♥", fr: "Coeur", en: "Hearts", color: "红", letter: "C" },
  { sym: "♦", fr: "Carreau", en: "Diamonds", color: "红", letter: "K" },
  { sym: "♣", fr: "Trèfle", en: "Clubs", color: "黑", letter: "T" },
];
const CARD_RANKS = ["As", "2", "3", "4", "5", "6", "7", "8", "9", "10", "Valet", "Dame", "Roi"];
const CARD_SHORT = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "V", "D", "R"];
const CARD_FIGURE = {
  "V♠": "Ogier", "D♠": "Pallas", "R♠": "David",
  "V♥": "Lahire", "D♥": "Judith", "R♥": "Charles",
  "V♦": "Hector", "D♦": "Rachel", "R♦": "César",
  "V♣": "Lancelot", "D♣": "Argine", "R♣": "Alexandre",
};
const opCard = runOp(
  "d3-card", CAT_GAME,
  "扑克牌名称/人物/缩写（Cartes à Jouer）",
  "52 张法式扑克牌参考表：Pique/Coeur/Carreau/Trèfle、As..Roi、传统人物名（Lahire/Judith/Charles…）、缩写（VP/DC…）与 Unicode 花色；可按 V♥、Dame de Pique、Lahire 查询",
  (t, p) => {
    const mode = String((p && p.mode) || "lookup");
    const src = String(t || "").trim();
    if (mode === "list" || !src) {
      const lines = [];
      for (const s of CARD_SUITS) {
        for (let i = 0; i < 13; i++) {
          const key = `${CARD_SHORT[i]}${s.sym}`;
          const fig = CARD_FIGURE[key];
          lines.push(`${s.sym} ${CARD_RANKS[i]} de ${s.fr} (${CARD_SHORT[i]}${s.letter})${fig ? ` — ${fig}` : ""}`);
        }
      }
      return `法式 52 张牌：\n${lines.join("\n")}`;
    }
    let suit = null, rank = null;
    const symM = src.match(/^([A1-9]|10|V|D|R|J|Q|K)\s*([♠♥♦♣])$/i);
    if (symM) {
      const r = symM[1].toUpperCase();
      rank = r === "A" || r === "1" ? 0 : r === "V" || r === "J" ? 10 : r === "D" || r === "Q" ? 11 : r === "R" || r === "K" ? 12 : Number(r) - 1;
      suit = CARD_SUITS.find((s) => s.sym === symM[2]);
    } else {
      const frM = src.match(/^(As|Valet|Dame|Roi|[2-9]|10)\s+(?:de\s+)?(Pique|Coeur|Carreau|Trèfle)$/i);
      if (frM) {
        rank = CARD_RANKS.findIndex((x) => x.toLowerCase() === frM[1].toLowerCase());
        suit = CARD_SUITS.find((s) => s.fr.toLowerCase() === frM[2].toLowerCase());
      } else {
        const enM = src.match(/^(Ace|Jack|Queen|King|[2-9]|10)\s+of\s+(Spades|Hearts|Diamonds|Clubs)$/i);
        if (enM) {
          const r = enM[1].toLowerCase();
          rank = r === "ace" ? 0 : r === "jack" ? 10 : r === "queen" ? 11 : r === "king" ? 12 : Number(r) - 1;
          suit = CARD_SUITS.find((s) => s.en.toLowerCase() === enM[2].toLowerCase());
        } else {
          const figEntry = Object.entries(CARD_FIGURE).find(([, name]) => name.toLowerCase() === src.toLowerCase());
          if (figEntry) {
            const key = figEntry[0];
            suit = CARD_SUITS.find((s) => s.sym === key.slice(-1));
            rank = key[0] === "V" ? 10 : key[0] === "D" ? 11 : 12;
          }
        }
      }
    }
    if (!suit || rank === null || rank < 0 || rank > 12 || !Number.isInteger(rank)) throw new Error("无法识别牌名：用 V♥ / Dame de Pique / Lahire / Queen of Hearts");
    const key = `${CARD_SHORT[rank]}${suit.sym}`;
    const fig = CARD_FIGURE[key];
    return `${src} = ${CARD_RANKS[rank]} de ${suit.fr}（${CARD_RANKS[rank]} of ${suit.en}）\n点数=${rank + 1 === 1 ? 14 : rank + 1}，${suit.color}色，${rank >= 10 ? "honor/人物牌" : "数字牌"}${fig ? `，传统人物=${fig}` : ""}\n缩写=${CARD_SHORT[rank]}${suit.letter}，Unicode 花色=${suit.sym}`;
  },
  [SEL("mode", "模式", "lookup", [{ value: "lookup", label: "查询单张（空输入则列 52 张）" }, { value: "list", label: "列出 52 张" }])]
);

// =====================================================================================
// 18. Mastermind
// =====================================================================================
function mmScore(code, guess) {
  let black = 0, white = 0;
  const rest = new Map();
  for (let i = 0; i < code.length; i++) {
    if (code[i] === guess[i]) black++;
    else rest.set(code[i], (rest.get(code[i]) || 0) + 1);
  }
  for (let i = 0; i < code.length; i++) {
    if (code[i] === guess[i]) continue;
    const c = guess[i];
    const k = rest.get(c) || 0;
    if (k > 0) { white++; rest.set(c, k - 1); }
  }
  return [black, white];
}
const opMastermind = runOp(
  "d3-mastermind", CAT_GAME,
  "Mastermind 候选枚举",
  "第一行『长度 颜色字母表』（如 4 RGBYOP），随后每行『猜测:黑,白』；枚举全部一致代码。长度 ≤6、字母表 ≤8、总量 ≤1e6",
  (t) => {
    const { main } = splitDoc(t);
    const lines = main.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
    if (!lines.length) throw new Error("第一行给『4 RGBYOP』");
    const hm = lines[0].match(/^(\d+)\s+([A-Za-z]+)$/);
    if (!hm) throw new Error("首行格式应为『4 RGBYOP』");
    const L = Number(hm[1]);
    const alphabet = [...new Set(hm[2].toUpperCase())];
    if (!Number.isInteger(L) || L < 1 || L > 6) throw new Error("长度需 1..6");
    if (alphabet.length < 2 || alphabet.length > 8) throw new Error("颜色需 2..8 种");
    if (alphabet.length ** L > 1e6) throw new Error("搜索空间超过 1e6");
    if (lines.length < 2) throw new Error("至少给一行『RGBY:2,1』");
    const hist = lines.slice(1).map((l) => {
      const m = l.replace(/\s/g, "").match(/^([A-Za-z]+):(\d+)[,;](\d+)$/);
      if (!m) throw new Error(`行「${l}」格式应为 RGBY:2,1`);
      if (m[1].length !== L) throw new Error(`「${l}」猜测长度应为 ${L}`);
      return { g: m[1].toUpperCase(), b: Number(m[2]), w: Number(m[3]) };
    });
    const out = [];
    const idx = new Array(L).fill(0);
    for (let n = 0; n < alphabet.length ** L; n++) {
      let x = n;
      for (let i = 0; i < L; i++) { idx[i] = x % alphabet.length; x = Math.floor(x / alphabet.length); }
      const code = idx.map((k) => alphabet[k]).join("");
      if (hist.every((h) => { const [b, w] = mmScore(code, h.g); return b === h.b && w === h.w; })) {
        out.push(code);
        if (out.length > 5000) throw new Error("候选超过 5000，请再加反馈");
      }
    }
    return out.length ? `一致候选 ${out.length} 个：\n${out.join(" ")}` : "无候选（反馈矛盾）";
  }
);

// =====================================================================================
// 19. 幻方
// =====================================================================================
function oddMagic(n) {
  const m = Array.from({ length: n }, () => new Array(n).fill(0));
  let r = 0, c = Math.floor(n / 2);
  for (let k = 1; k <= n * n; k++) {
    m[r][c] = k;
    const nr = (r - 1 + n) % n, nc = (c + 1) % n;
    if (m[nr][nc]) r = (r + 1) % n;
    else { r = nr; c = nc; }
  }
  return m;
}
function singlyEvenMagic(n) {
  const half = n / 2, size = n * n, sub = oddMagic(half), ss = size / 4;
  const factors = [0, 2, 3, 1];
  const res = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    const q = Math.floor(r / half) * 2 + Math.floor(c / half);
    res[r][c] = sub[r % half][c % half] + factors[q] * ss;
  }
  const left = Math.floor(half / 2), right = left - 1;
  for (let r = 0; r < half; r++) for (let c = 0; c < n; c++) {
    if (c < left || c >= n - right || (c === left && r === left)) {
      if (c === 0 && r === left) continue;
      [res[r][c], res[r + half][c]] = [res[r + half][c], res[r][c]];
    }
  }
  return res;
}
function doublyEvenMagic(n) {
  const m = Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => r * n + c + 1));
  const k = n / 4;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const a = i < k || i >= n - k;
    const b = j < k || j >= n - k;
    const centre = i >= k && i < n - k && j >= k && j < n - k;
    if ((a && b) || centre) m[i][j] = n * n + 1 - m[i][j];
  }
  return m;
}
function checkMagic(m) {
  const n = m.length, S = n * (n * n + 1) / 2;
  for (let i = 0; i < n; i++) {
    if (m[i].reduce((a, b) => a + b, 0) !== S) return `第 ${i + 1} 行和不为 ${S}`;
    let cs = 0;
    for (let j = 0; j < n; j++) cs += m[j][i];
    if (cs !== S) return `第 ${i + 1} 列和不为 ${S}`;
  }
  let d1 = 0, d2 = 0;
  for (let i = 0; i < n; i++) { d1 += m[i][i]; d2 += m[i][n - 1 - i]; }
  if (d1 !== S || d2 !== S) return `对角线和不为 ${S}`;
  return null;
}
const opMagicSquare = runOp(
  "d3-magicsquare", CAT_NUM,
  "幻方生成 / 校验（Carré Magique）",
  "n=3..12 生成标准 1..n² 幻方（奇数=Siamese、4 的倍数=补数、单偶数=Strachey）；也可输入 n 行数字做校验。输出幻和",
  (t, p) => {
    const src = String(t || "").trim();
    if (/[\n\s]/.test(src) && /^[\d\s]+$/.test(src)) {
      const rows = parseList(src).map((r) => r.trim().split(/\s+/).map(Number));
      const n = rows.length;
      if (n < 3 || n > 12 || !rows.every((r) => r.length === n && r.every(Number.isInteger))) throw new Error("校验模式需 n 行 n 列整数（3..12）");
      const err = checkMagic(rows);
      return err ? `不是幻方：${err}` : `是幻方：n=${n}，幻和=${n * (n * n + 1) / 2}`;
    }
    const n = Number((p && p.n) || src) || 0;
    if (!Number.isInteger(n) || n < 3 || n > 12) throw new Error("阶数需 3..12");
    let m;
    if (n % 2 === 1) m = oddMagic(n);
    else if (n % 4 === 0) m = doublyEvenMagic(n);
    else m = singlyEvenMagic(n);
    const err = checkMagic(m);
    if (err) throw new Error("内部生成校验失败：" + err);
    return `${n} 阶幻方（幻和 ${n * (n * n + 1) / 2}）：\n${m.map((r) => r.join("\t")).join("\n")}`;
  },
  [P("n", "阶数 3..12（或输入 n 行数字校验）", "3")]
);

// =====================================================================================
// 20. 24 点 / Le Compte Est Bon / Mathador / Krypto / All Ten
// =====================================================================================
const ratGcd = (a, b) => { a = a < 0n ? -a : a; b = b < 0n ? -b : b; while (b) { [a, b] = [b, a % b]; } return a || 1n; };
function rat(n, d = 1n) {
  if (d === 0n) throw new Error("分母为 0");
  if (d < 0n) { n = -n; d = -d; }
  const g = ratGcd(n, d);
  return { n: n / g, d: d / g };
}
const ratAdd = (a, b) => rat(a.n * b.d + b.n * a.d, a.d * b.d);
const ratSub = (a, b) => rat(a.n * b.d - b.n * a.d, a.d * b.d);
const ratMul = (a, b) => rat(a.n * b.n, a.d * b.d);
const ratDiv = (a, b) => { if (b.n === 0n) return null; return rat(a.n * b.d, a.d * b.n); };
function solveArithmetic(nums, target, allowFrac, budget) {
  const start = nums.map((n) => ({ r: rat(BigInt(n)), e: String(n) }));
  const want = rat(BigInt(target));
  let nodes = 0;
  const rec = (items) => {
    if (++nodes > budget) throw new Error(`搜索超 ${budget} 节点`);
    if (items.length === 1) return items[0].r.n === want.n && items[0].r.d === want.d ? items[0].e : null;
    for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
      const a = items[i], b = items[j];
      const rest = items.filter((_, k) => k !== i && k !== j);
      const cand = [
        [ratAdd(a.r, b.r), `(${a.e} + ${b.e})`],
        [ratSub(a.r, b.r), `(${a.e} - ${b.e})`],
        [ratSub(b.r, a.r), `(${b.e} - ${a.e})`],
        [ratMul(a.r, b.r), `(${a.e} * ${b.e})`],
        [ratDiv(a.r, b.r), `(${a.e} / ${b.e})`],
        [ratDiv(b.r, a.r), `(${b.e} / ${a.e})`],
      ];
      for (const [r, e] of cand) {
        if (!r) continue;
        if (!allowFrac && r.d !== 1n) continue;
        const got = rec([...rest, { r, e }]);
        if (got) return got;
      }
    }
    return null;
  };
  const expr = rec(start);
  return { expr, nodes };
}
const opCountdown = runOp(
  "d3-countdown", CAT_NUM,
  "24 点 / Le Compte Est Bon / Mathador / Krypto / All Ten",
  "用给定数字各一次，+ - * / 凑目标。默认只允许整数中间值（Le Compte Est Bon/24 点），Mathador 模式允许分数。All Ten 模式对 4 个数字输出 1..10 的式子。搜索有界",
  (t, p) => {
    const mode = String((p && p.mode) || "countdown");
    const nums = parseNums((p && p.nums) || t).map((x) => Math.trunc(x));
    if (!nums.length || nums.length > 6) throw new Error("给 1..6 个整数（空格/逗号分隔）");
    if (nums.some((n) => !Number.isFinite(n) || n < 0 || n > 1e6)) throw new Error("数字需为 0..1e6 的整数");
    const allowFrac = mode === "mathador" || String((p && p.frac) || "non") === "oui";
    const budget = Math.min(Number((p && p.budget) || 300000) || 300000, 2e6);
    if (mode === "allten") {
      if (nums.length !== 4) throw new Error("All Ten 需要 4 个数字");
      const lines = [];
      for (let target = 1; target <= 10; target++) {
        try {
          const { expr } = solveArithmetic(nums, target, false, budget);
          lines.push(`${target} = ${expr || "无解"}`);
        } catch (e) { lines.push(`${target} = 搜索超限`); }
      }
      return `All Ten（${nums.join(",")}）：\n${lines.join("\n")}`;
    }
    const target = Number((p && p.target) || (mode === "24" ? 24 : 24));
    if (!Number.isInteger(target)) throw new Error("目标需为整数");
    const { expr, nodes } = solveArithmetic(nums, target, allowFrac, budget);
    if (!expr) return `无解：${nums.join(",")} → ${target}（搜索 ${nodes} 节点${allowFrac ? "，允许分数" : "，整数中间值"}）`;
    const clean = expr.startsWith("(") && expr.endsWith(")") ? expr.slice(1, -1) : expr;
    return `${nums.join(",")} → ${target}：${clean} = ${target}\n（搜索 ${nodes} 节点${allowFrac ? "，允许分数" : "，整数中间值"}）`;
  },
  [SEL("mode", "模式", "countdown", [{ value: "countdown", label: "Le Compte Est Bon" }, { value: "24", label: "24 点" }, { value: "mathador", label: "Mathador（允许分数）" }, { value: "krypto", label: "Krypto" }, { value: "allten", label: "All Ten" }]), P("target", "目标", "24"), P("nums", "数字（可空，用输入）", ""), P("budget", "节点预算", "300000"), SEL("frac", "允许分数", "non", [{ value: "non", label: "否（整数中间值）" }, { value: "oui", label: "是" }])]
);

// =====================================================================================
// 21. 广义数独（8/10/16、Wordoku）
// =====================================================================================
const SUDOKU_BOX = { 4: [2, 2], 6: [2, 3], 8: [2, 4], 9: [3, 3], 10: [2, 5], 12: [3, 4], 16: [4, 4] };
const opSudokuN = runOp(
  "d3-sudoku-n", CAT_NUM,
  "数独 · 尺寸泛化（8×8 / 10×10 / 16×16 / Wordoku）",
  "标准盒式数独：8×8(2×4)、10×10(2×5)、16×16(4×4)、9×9 字母 Wordoku。0/_/. 为空；完整盘只校验，有空格则回溯求解（MRV，节点上限 3e6）。4/6/9/12 已有 game-sudoku",
  (t, p) => {
    const src = String(t || "").trim();
    const rowsRaw = parseList(src).map((r) => r.replace(/[\s,]+/g, ""));
    const n = rowsRaw.length;
    const box = SUDOKU_BOX[n];
    if (!box) throw new Error("尺寸支持 4/6/8/9/10/12/16（n 行 n 列）");
    if (!rowsRaw.every((r) => r.length === n)) throw new Error(`需要 ${n} 行 × ${n} 列`);
    const joined = rowsRaw.join("");
    const letterMode = /[A-Za-z]/.test(joined) && !/\d/.test(joined.replace(/0/g, ""));
    const charset = letterMode ? "ABCDEFGHIJKLMNOP".slice(0, n) : "123456789ABCDEFG".slice(0, n);
    const mapCh = (c) => {
      if (/[._? ]/.test(c)) return 0;
      if (c === "0") return n === 10 ? 10 : 0; // 10×10 用 0 表示 10；空格请用 _ 或 .
      const v = charset.indexOf(c.toUpperCase()) + 1;
      if (v < 1) throw new Error(`无法识别数独符号「${c}」`);
      return v;
    };
    const grid = rowsRaw.map((r) => [...r].map(mapCh));
    for (const r of grid) for (const v of r) if (v < 0 || v > n) throw new Error(`符号超范围（1..${n}）`);
    const ok = (i, j, v) => {
      for (let k = 0; k < n; k++) if (grid[i][k] === v || grid[k][j] === v) return false;
      const [bh, bw] = box;
      const r0 = Math.floor(i / bh) * bh, c0 = Math.floor(j / bw) * bw;
      for (let r = r0; r < r0 + bh; r++) for (let c = c0; c < c0 + bw; c++) if (grid[r][c] === v) return false;
      return true;
    };
    let empty = 0;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      if (!grid[i][j]) { empty++; continue; }
      const v = grid[i][j]; grid[i][j] = 0;
      if (!ok(i, j, v)) { grid[i][j] = v; return `无效：行/列/宫冲突（${i + 1},${j + 1} = ${v}）`; }
      grid[i][j] = v;
    }
    if (!empty) return `有效：${n}×${n} 完整解，行/列/宫均满足`;
    let nodes = 0;
    const rec = () => {
      if (++nodes > 3e6) throw new Error("搜索节点超 3e6");
      let best = null, bestC = null;
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
        if (grid[i][j]) continue;
        const cand = [];
        for (let v = 1; v <= n; v++) if (ok(i, j, v)) cand.push(v);
        if (!cand.length) return false;
        if (!bestC || cand.length < bestC.length) { best = [i, j]; bestC = cand; if (cand.length === 1) break; }
      }
      if (!best) return true;
      const [i, j] = best;
      for (const v of bestC) {
        grid[i][j] = v;
        if (rec()) return true;
        grid[i][j] = 0;
      }
      return false;
    };
    if (!rec()) return "无解（请检查盘面）";
    return `解（${nodes} 节点）：\n${grid.map((r) => r.map((v) => charset[v - 1]).join("")).join("\n")}`;
  }
);

// =====================================================================================
// 22. BEGHILOS / TI-30 计算器文字
// =====================================================================================
const BE_ENCODE = { B: "8", b: "9", E: "3", e: "3", G: "6", g: "6", H: "4", h: "4", I: "1", i: "1", L: "7", l: "7", O: "0", o: "0", S: "5", s: "5", Z: "2", z: "2" };
const BE_DECODE = { "0": "O", "1": "I", "2": "Z", "3": "E", "4": "h", "5": "S", "6": "G", "7": "L", "8": "B", "9": "b" };
const TI30 = { A: "4", B: "8", C: "2", D: "0", E: "3", F: "7", G: "6", H: "4", I: "1", J: "1", K: "4", L: "7", M: "3", N: "2", O: "0", P: "9", Q: "9", R: "7", S: "5", T: "7", U: "7", V: "7", W: "3", X: "7", Y: "7", Z: "2" };
const TI30_REV = (() => { const m = new Map(); for (const [k, v] of Object.entries(TI30)) { if (!m.has(v)) m.set(v, []); m.get(v).push(k); } return m; })();
const opCalcspell = runOp(
  "d3-calcspell", CAT_NUM,
  "计算器文字（BEGHILOS / TI-30）",
  "BEGHILOS：字母→七段数字后整串反转（GOOGLE → 376006），仅 BEGHILOSZ 字母可编码；TI-30：按 dCode 表 A4J1S5B8K4T7C2L7U7D0M3V7E3N2W3F7O0X7G6P9Y7H4Q9Z2I1R7，编码多对一，解码给歧义集合",
  (t, p) => {
    const table = String((p && p.table) || "beghilos");
    const dir = String((p && p.dir) || "encode");
    const raw = String(t || "").replace(/\s+/g, "");
    if (!raw) throw new Error("需要非空文本");
    if (table === "ti30") {
      const s = raw.toUpperCase();
      if (dir === "decode") {
        if (!/^\d+$/.test(s)) throw new Error("TI-30 解码输入需为数字");
        return [...s].map((d) => `${d}→${(TI30_REV.get(d) || []).join("/") || "?"}`).join("\n");
      }
      let out = "";
      for (const c of s) {
        if (!TI30[c]) throw new Error(`TI-30 无法表示字母「${c}」（仅 A-Z）`);
        out += TI30[c];
      }
      return out;
    }
    const s = raw;
    if (dir === "decode") {
      if (!/^\d+$/.test(s)) throw new Error("BEGHILOS 解码输入需为数字");
      return [...s].reverse().map((d) => BE_DECODE[d] || "?").join("");
    }
    let out = "";
    for (const c of s) {
      if (!BE_ENCODE[c]) throw new Error(`BEGHILOS 无法表示字母「${c}」（仅 BEGHILOSZ）`);
      out += BE_ENCODE[c];
    }
    return [...out].reverse().join("");
  },
  [SEL("table", "表", "beghilos", [{ value: "beghilos", label: "BEGHILOS" }, { value: "ti30", label: "TI-30" }]), SEL("dir", "方向", "encode", [{ value: "encode", label: "文字→数字" }, { value: "decode", label: "数字→文字" }])]
);

// =====================================================================================
// 23. Pi / Tau / e / Phi 小数与数字检索
// =====================================================================================
function atanInv(x, scale) {
  const X = BigInt(x), X2 = X * X;
  let term = scale / X, sum = term;
  for (let k = 1n; ; k++) {
    term /= X2;
    if (term === 0n) break;
    const t = term / (2n * k + 1n);
    if (t === 0n) break;
    sum += k % 2n === 1n ? -t : t;
  }
  return sum;
}
function piScaled(digits) {
  const guard = 12, scale = 10n ** BigInt(digits + guard);
  return 16n * atanInv(5, scale) - 4n * atanInv(239, scale);
}
function eScaled(digits) {
  const guard = 12, scale = 10n ** BigInt(digits + guard);
  let sum = scale, term = scale;
  for (let k = 1n; term !== 0n; k++) { term /= k; sum += term; }
  return sum;
}
function isqrt(n) {
  if (n < 2n) return n;
  let x = n, y = (x + 1n) / 2n;
  while (y < x) { x = y; y = (x + n / x) / 2n; }
  return x;
}
function phiScaled(digits) {
  const guard = 12, scale = 10n ** BigInt(digits + guard);
  return (isqrt(5n * scale * scale) + scale) / 2n;
}
function formatScaled(x, digits) {
  const guard = 12n;
  const s = (x / 10n ** guard).toString().padStart(digits + 1, "0");
  return s[0] + "." + s.slice(1, digits + 1);
}
const opConstants = runOp(
  "d3-constants", CAT_NUM,
  "常数小数与数字检索（Pi / Tau / e / Phi）",
  "BigInt 定点计算 π（Machin）、τ=2π、e（级数）、φ=(1+√5)/2；最多 500 位。可搜索子串，位置按小数点后 1 起计。覆盖 4 个『Décimales』工具与『Recherche dans les Décimales』",
  (t, p) => {
    const which = String((p && p.constant) || "pi");
    const digits = Math.max(1, Math.min(500, Number((p && p.digits) || 50) || 50));
    let scaled, label;
    if (which === "pi") { scaled = piScaled(digits); label = "π"; }
    else if (which === "tau") { scaled = 2n * piScaled(digits); label = "τ"; }
    else if (which === "e") { scaled = eScaled(digits); label = "e"; }
    else if (which === "phi") { scaled = phiScaled(digits); label = "φ"; }
    else throw new Error("常数支持 pi/tau/e/phi");
    const text = formatScaled(scaled, digits);
    const search = String((p && p.search) || t || "").replace(/\D/g, "");
    let extra = "";
    if (search) {
      const decimals = text.slice(2);
      const idx = decimals.indexOf(search);
      extra = idx >= 0 ? `\n搜索「${search}」：小数点后第 ${idx + 1} 位起` : `\n搜索「${search}」：前 ${digits} 位内未找到`;
    }
    return `${label} = ${text}\n（${digits} 位小数）${extra}`;
  },
  [SEL("constant", "常数", "pi", [{ value: "pi", label: "π" }, { value: "tau", label: "τ" }, { value: "e", label: "e" }, { value: "phi", label: "φ" }]), P("digits", "小数位数 1..500", "50"), P("search", "搜索数字串（可空）", "")]
);

// =====================================================================================
// 24. 生日悖论
// =====================================================================================
const opBirthday = runOp(
  "d3-birthday", CAT_NUM,
  "生日悖论概率（Probabilités d'Anniversaire）",
  "n 人中至少两人生日相同的概率（默认 365 天，可改天数）；浮点计算，n ≤ 10000",
  (t, p) => {
    const n = Number((p && p.n) || t) || 0;
    const days = Number((p && p.days) || 365) || 365;
    if (!Number.isInteger(n) || n < 1 || n > 10000) throw new Error("人数需 1..10000");
    if (!Number.isInteger(days) || days < 2 || days > 1e6) throw new Error("天数需 2..1e6");
    if (n > days) return `${n} 人 / ${days} 天：概率 = 100%（鸽巢原理）`;
    let prob = 1;
    for (let i = 0; i < n; i++) prob *= (days - i) / days;
    const q = 1 - prob;
    return `${n} 人 / ${days} 天：至少两人生日相同概率 = ${(q * 100).toFixed(4)}%（约 1/${(1 / q).toFixed(2)}）`;
  },
  [P("n", "人数", "23"), P("days", "天数", "365")]
);

// =====================================================================================
// 25. 星座 / 生肖
// =====================================================================================
const CHINESE = ["鼠", "牛", "虎", "兔", "龙", "蛇", "马", "羊", "猴", "鸡", "狗", "猪"];
const ELEMENTS = ["木", "木", "火", "火", "土", "土", "金", "金", "水", "水"];
const opZodiac = runOp(
  "d3-zodiac", CAT_NUM,
  "星座 / 生肖（Signe Astrologique）",
  "输入日期 YYYY-MM-DD 或年份：西方星座按标准日期边界；中国生肖按 (year−4) mod 12，附五行。仅文化映射，不做命理推算",
  (t, p) => {
    const src = String((p && p.date) || t || "").trim();
    const m = src.match(/^(\d{4})(?:-(\d{1,2})-(\d{1,2}))?$/);
    if (!m) throw new Error("格式：YYYY-MM-DD 或 YYYY");
    const year = Number(m[1]);
    const out = [];
    if (m[2] && m[3]) {
      const month = Number(m[2]), day = Number(m[3]);
      if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) throw new Error("月/日超范围");
      const md = month * 100 + day;
      let sign;
      const bounds = [[120, "水瓶座", "Aquarius"], [219, "双鱼座", "Pisces"], [321, "白羊座", "Aries"], [420, "金牛座", "Taurus"], [521, "双子座", "Gemini"], [621, "巨蟹座", "Cancer"], [723, "狮子座", "Leo"], [823, "处女座", "Virgo"], [923, "天秤座", "Libra"], [1023, "天蝎座", "Scorpio"], [1122, "射手座", "Sagittarius"], [1222, "摩羯座", "Capricorn"]];
      sign = md >= 1222 || md < 120 ? ["", "摩羯座", "Capricorn"] : bounds.filter((b) => md >= b[0]).pop();
      out.push(`西方星座：${sign[1]}（${sign[2]}）`);
    }
    const idx = ((year - 4) % 12 + 12) % 12;
    const el = ELEMENTS[((year - 4) % 10 + 10) % 10];
    out.push(`中国生肖：${el}${CHINESE[idx]}（${year}）`);
    return out.join("\n");
  },
  [P("date", "日期 YYYY-MM-DD 或年份", "2000-01-25")]
);

// =====================================================================================
// 26. 日期计算 / 格式 / 差 / 年内第几天 / 世纪
// =====================================================================================
function parseDate(s) {
  const m = String(s).trim().match(/^(\d{1,6})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!m) throw new Error(`日期「${s}」格式应为 YYYY-MM-DD`);
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  const h = Number(m[4] || 0), mi = Number(m[5] || 0), sec = Number(m[6] || 0);
  const dt = new Date(Date.UTC(y, mo - 1, d, h, mi, sec));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d || h > 23 || mi > 59 || sec > 59) throw new Error(`非法日期 ${s}`);
  return dt;
}
function fmtDate(dt) { return dt.toISOString().slice(0, 10); }
function daysInMonth(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }
const WEEK_EN = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const WEEK_ZH = ["日", "一", "二", "三", "四", "五", "六"];
const opDate = runOp(
  "d3-date", CAT_TEXT,
  "日期计算 / 差 / 格式 / 年内第几天 / 世纪",
  "ISO 日期（UTC）运算：星期、两日差、加天数/月数/年数、年内第几天、世纪、Unix 时间格式。覆盖 Calcul avec des Dates、Différence、Format、Jour de la Semaine、Nième Jour、Siècle",
  (t, p) => {
    const mode = String((p && p.mode) || "weekday");
    const src = String(t || "").trim();
    if (mode === "diff") {
      const parts = src.split(/^\s*={3,}\s*$/m);
      if (parts.length !== 2) throw new Error("两段日期用一行 === 分隔");
      const a = parseDate(parts[0]), b = parseDate(parts[1]);
      const days = Math.round((b - a) / 86400000);
      return `${fmtDate(a)} → ${fmtDate(b)}：${days} 天（${Math.floor(days / 7)} 周 ${days % 7} 天）`;
    }
    if (mode === "century") {
      const y = Number(src.split(/\r?\n/)[0]);
      if (!Number.isInteger(y) || y < 1 || y > 999999) throw new Error("世纪模式给年份（如 2001）");
      const c = Math.floor((y - 1) / 100) + 1;
      const suf = c % 100 >= 11 && c % 100 <= 13 ? "th" : c % 10 === 1 ? "st" : c % 10 === 2 ? "nd" : c % 10 === 3 ? "rd" : "th";
      return `${y} 年属于 ${c} 世纪（${c}${suf} century）`;
    }
    const dt = parseDate(src.split(/\r?\n/)[0]);
    const y = dt.getUTCFullYear(), mo = dt.getUTCMonth() + 1, d = dt.getUTCDate();
    if (mode === "weekday") return `${fmtDate(dt)}：星期${WEEK_ZH[dt.getUTCDay()]}（${WEEK_EN[dt.getUTCDay()]}）`;
    if (mode === "doy") {
      const start = Date.UTC(y, 0, 1);
      return `${fmtDate(dt)} 是 ${y} 年第 ${Math.floor((dt - start) / 86400000) + 1} 天（${(y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? "闰年" : "平年"}）`;
    }
    if (mode === "add") {
      const days = Number((p && p.days) || 0) || 0;
      const months = Number((p && p.months) || 0) || 0;
      const years = Number((p && p.years) || 0) || 0;
      let ny = y + years, nm = mo + months;
      while (nm > 12) { nm -= 12; ny++; }
      while (nm < 1) { nm += 12; ny--; }
      const nd = Math.min(d, daysInMonth(ny, nm));
      const out = new Date(Date.UTC(ny, nm - 1, nd));
      out.setUTCDate(out.getUTCDate() + days);
      return `${fmtDate(dt)} + ${years}年${months}月${days}日 = ${fmtDate(out)}`;
    }
    if (mode === "format") {
      return [
        `ISO: ${fmtDate(dt)}`,
        `UTC: ${dt.toISOString()}`,
        `Unix 秒: ${Math.floor(dt.getTime() / 1000)}`,
        `Unix 毫秒: ${dt.getTime()}`,
        `星期: ${WEEK_EN[dt.getUTCDay()]}`,
        `年内第 ${Math.floor((dt - Date.UTC(y, 0, 1)) / 86400000) + 1} 天`,
      ].join("\n");
    }
    throw new Error(`未知模式 ${mode}`);
  },
  [SEL("mode", "模式", "weekday", [{ value: "weekday", label: "星期" }, { value: "diff", label: "两日差" }, { value: "add", label: "日期加" }, { value: "doy", label: "年内第几天" }, { value: "century", label: "世纪" }, { value: "format", label: "多格式" }]), P("days", "加天数", "0"), P("months", "加月数", "0"), P("years", "加年数", "0")]
);

// =====================================================================================
// 27. 拉丁语日期
// =====================================================================================
const LATIN_MONTHS = [
  { nom: "Ianuarius", acc: "Ianuarias", abl: "Ianuariis", nones: 5, ides: 13 },
  { nom: "Februarius", acc: "Februarias", abl: "Februariis", nones: 5, ides: 13 },
  { nom: "Martius", acc: "Martias", abl: "Martiis", nones: 7, ides: 15 },
  { nom: "Aprilis", acc: "Apriles", abl: "Aprilibus", nones: 5, ides: 13 },
  { nom: "Maius", acc: "Maias", abl: "Maiis", nones: 7, ides: 15 },
  { nom: "Iunius", acc: "Iunias", abl: "Iuniis", nones: 5, ides: 13 },
  { nom: "Iulius", acc: "Iulias", abl: "Iuliis", nones: 7, ides: 15 },
  { nom: "Augustus", acc: "Augustas", abl: "Augustis", nones: 5, ides: 13 },
  { nom: "September", acc: "Septembres", abl: "Septembribus", nones: 5, ides: 13 },
  { nom: "October", acc: "Octobres", abl: "Octobribus", nones: 5, ides: 13 },
  { nom: "November", acc: "Novembres", abl: "Novembribus", nones: 5, ides: 13 },
  { nom: "December", acc: "Decembres", abl: "Decembribus", nones: 5, ides: 13 },
];
const LATIN_ORD = { 2: "Pridie", 3: "tertium", 4: "quartum", 5: "quintum", 6: "sextum", 7: "septimum", 8: "octavum", 9: "nonum", 10: "decimum", 11: "undecimum", 12: "duodecimum", 13: "tertium decimum", 14: "quartum decimum", 15: "quintum decimum", 16: "sextum decimum", 17: "septimum decimum", 18: "duodevicesimum", 19: "undevicesimum" };
function latinDayPhrase(day, monthIdx, year) {
  const m = LATIN_MONTHS[monthIdx];
  const last = daysInMonth(year, monthIdx + 1);
  if (day === 1) return `Kalendis ${m.abl}`;
  if (day === m.nones) return `Nonis ${m.abl}`;
  if (day === m.ides) return `Idibus ${m.abl}`;
  let refName, refAcc, refDay, nextMonth;
  if (day < m.nones) { refName = "Nonas"; refAcc = m.acc; refDay = m.nones; }
  else if (day < m.ides) { refName = "Idus"; refAcc = m.acc; refDay = m.ides; }
  else {
    nextMonth = monthIdx === 11 ? 0 : monthIdx + 1;
    refName = "Kalendas"; refAcc = LATIN_MONTHS[nextMonth].acc; refDay = last + 1;
  }
  const count = refDay - day + 1;
  if (count === 2) return `Pridie ${refName} ${refAcc}`;
  return `Ante diem ${LATIN_ORD[count] || count + "um"} ${refName} ${refAcc}`;
}
const opLatinDate = runOp(
  "d3-latin-date", CAT_TEXT,
  "拉丁语日期（Date en Latin）",
  "罗马历：Kalendae/Nonae/Idus 与包含计数（1 日 Kalendis，3 月 3 日 Ante diem quintum Nonas Martias，3 月 31 日 Pridie Kalendas Apriles）。输入 YYYY-MM-DD",
  (t) => {
    const dt = parseDate(String(t).trim().split(/\r?\n/)[0]);
    const m = dt.getUTCMonth(), d = dt.getUTCDate();
    return `${fmtDate(dt)} = ${latinDayPhrase(d, m, dt.getUTCFullYear())}\n（${LATIN_MONTHS[m].nom}，罗马历包含计数）`;
  }
);

// =====================================================================================
// 28. 相对论时间膨胀
// =====================================================================================
const opTimeDilation = runOp(
  "d3-timedilation", CAT_TEXT,
  "时间膨胀（Dilatation du Temps）",
  "狭义相对论 γ=1/√(1−β²)：输入 β=v/c（0≤β<1），输出 γ 与 1 年固有时对应的外部时间。也可给 m/s（mode=velocity）",
  (t, p) => {
    const mode = String((p && p.mode) || "beta");
    const x = Number((p && p.value) || t) || 0;
    if (!Number.isFinite(x) || x < 0) throw new Error("需要非负数");
    const beta = mode === "velocity" ? x / 299792458 : x;
    if (beta >= 1) throw new Error("β 需 <1（有静质量物体不能达到光速）");
    const gamma = 1 / Math.sqrt(1 - beta * beta);
    return `β = v/c = ${beta}\nγ = ${gamma.toFixed(9)}\n固有时 1 年 → 外部参考系 ${gamma.toFixed(6)} 年`;
  },
  [P("value", "β 或 v（m/s）", "0.8"), SEL("mode", "输入", "beta", [{ value: "beta", label: "β=v/c" }, { value: "velocity", label: "v (m/s)" }])]
);

// =====================================================================================
// 29. AMI 交替传导反转码
// =====================================================================================
const opAmi = runOp(
  "d3-ami", CAT_TEXT,
  "AMI 交替传导反转码（Alternate Mark Inversion）",
  "位 0 → 零电平 0；位 1 → 交替 +/−。decode 把非零符号还原为 1、0 还原为 0；不做时钟恢复",
  (t, p) => {
    const mode = String((p && p.dir) || "encode");
    const src = String(t || "").trim();
    if (mode === "decode") {
      const toks = src.split(/[\s,]+/).filter(Boolean);
      let out = "";
      for (const tok of toks) {
        if (tok === "0") out += "0";
        else if (tok === "+" || tok === "-" || tok === "+1" || tok === "-1" || tok === "1") out += "1";
        else throw new Error(`未知 AMI 符号「${tok}」`);
      }
      return out;
    }
    const bits = src.replace(/[^01]/g, "");
    if (!bits) throw new Error("需要 0/1 位串");
    let pos = true, out = [];
    for (const b of bits) {
      if (b === "0") out.push("0");
      else { out.push(pos ? "+" : "-"); pos = !pos; }
    }
    return out.join(" ");
  },
  [SEL("dir", "方向", "encode", [{ value: "encode", label: "位串→电平" }, { value: "decode", label: "电平→位串" }])]
);

// =====================================================================================
// 30. 国际象棋记谱（FEN / UCI / SAN）
// =====================================================================================
function parseFen(fen) {
  const parts = String(fen).trim().split(/\s+/);
  if (parts.length !== 6) throw new Error("FEN 需 6 个字段");
  const [board, side, castling, ep, half, full] = parts;
  const ranks = board.split("/");
  if (ranks.length !== 8) throw new Error("FEN 棋盘需 8 行");
  const grid = ranks.map((rank) => {
    const row = [];
    for (const ch of rank) {
      if (/\d/.test(ch)) {
        const n = Number(ch);
        if (n < 1 || n > 8) throw new Error("FEN 行内数字需 1..8");
        for (let i = 0; i < n; i++) row.push(".");
      } else if (/[prnbqkPRNBQK]/.test(ch)) row.push(ch);
      else throw new Error(`FEN 非法棋子「${ch}」`);
    }
    if (row.length !== 8) throw new Error("FEN 每行必须展开为 8 格");
    return row;
  });
  if (!/^[wb]$/.test(side)) throw new Error("FEN 行棋方需 w/b");
  if (!/^(-|K?Q?k?q?)$/.test(castling)) throw new Error("FEN 王车易位字段非法");
  if (!/^(-|[a-h][36])$/.test(ep)) throw new Error("FEN 吃过路兵字段非法");
  if (!/^\d+$/.test(half) || !/^\d+$/.test(full)) throw new Error("FEN 半回合/回合字段需数字");
  return { grid, side, castling, ep, half, full, board };
}
const opChess = runOp(
  "d3-chess", CAT_GAME,
  "国际象棋记谱（FEN / UCI / SAN）",
  "FEN 解析/校验并输出 ASCII 棋盘；UCI 走法解析为起止格/升变；SAN 解析子力、起止、吃子、升变、将军标记。仅记谱解析，不校验走法合法性",
  (t, p) => {
    const mode = String((p && p.mode) || "fen");
    const src = String(t || "").trim();
    if (!src) throw new Error("需要非空输入");
    if (mode === "fen") {
      const f = parseFen(src.split(/\r?\n/)[0]);
      const ascii = f.grid.map((row, i) => `${8 - i} ${row.join(" ")}`).join("\n");
      return `FEN 有效（${f.side === "w" ? "白" : "黑"}方行棋）：
${ascii}
  a b c d e f g h
行棋方=${f.side} 易位=${f.castling} 吃过路兵=${f.ep} 半回合=${f.half} 回合=${f.full}`;
    }
    if (mode === "uci") {
      const moves = src.split(/[\s,]+/).filter(Boolean);
      const out = moves.map((mv, i) => {
        const m = mv.match(/^([a-h][1-8])([a-h][1-8])([qrbnQRBN])?$/);
        if (!m) throw new Error(`UCI 走法「${mv}」非法（应为 e2e4 / e7e8q）`);
        return `${i + 1}. ${m[1]} → ${m[2]}${m[3] ? ` 升变=${m[3].toUpperCase()}` : ""}`;
      });
      return out.join("\n");
    }
    if (mode === "san") {
      const toks = src.split(/[\s,]+/).filter(Boolean);
      const out = toks.map((tok) => {
        if (/^O-O(-O)?[+#]?$/.test(tok)) return `${tok}：${tok.startsWith("O-O-O") ? "后翼" : "王翼"}易位`;
        const m = tok.match(/^([KQRBN])?([a-h])?([1-8])?(x)?([a-h][1-8])(?:=([QRBN]))?([+#])?$/);
        if (!m) throw new Error(`SAN 记号「${tok}」非法`);
        return `${tok}：子力=${m[1] || "兵"} 起始文件=${m[2] || "—"} 起始行=${m[3] || "—"} 吃子=${m[4] ? "是" : "否"} 目标=${m[5]}${m[6] ? ` 升变=${m[6]}` : ""}${m[7] ? ` ${m[7] === "+" ? "将军" : "将死"}` : ""}`;
      });
      return out.join("\n");
    }
    throw new Error("模式支持 fen/uci/san");
  },
  [SEL("mode", "模式", "fen", [{ value: "fen", label: "FEN 解析" }, { value: "uci", label: "UCI 走法" }, { value: "san", label: "SAN 记谱" }])]
);

// =====================================================================================
// 31. MIDI / 音名 / 频率
// =====================================================================================
const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const NOTE_ALIASES = { "DO": 0, "DO#": 1, "RÉ": 2, "RE": 2, "RÉ#": 3, "RE#": 3, "MI": 4, "FA": 5, "FA#": 6, "SOL": 7, "SOL#": 8, "LA": 9, "LA#": 10, "SI": 11, "UT": 0 };
function noteToMidi(s) {
  const m = String(s).trim().toUpperCase().replace(/♯/g, "#").replace(/♭/g, "B").match(/^([A-G]|DO|RÉ|RE|MI|FA|SOL|LA|SI|UT)(#|B)?(-?\d+)$/);
  if (!m) throw new Error(`音名「${s}」非法（如 A4 / C#5 / do4）`);
  let pc;
  if (NOTE_ALIASES[m[1]] !== undefined) pc = NOTE_ALIASES[m[1]];
  else pc = NOTE_NAMES.indexOf(m[1]);
  if (m[2] === "#") pc++; else if (m[2] === "B") pc--;
  pc = ((pc % 12) + 12) % 12;
  const midi = (Number(m[3]) + 1) * 12 + pc;
  if (midi < 0 || midi > 127) throw new Error("MIDI 范围 0..127");
  return midi;
}
function midiBytesFromInput(s) {
  const t = String(s || "").trim();
  const hex = t.replace(/[\s,]/g, "");
  if (/^[0-9a-fA-F]+$/.test(hex) && hex.length % 2 === 0 && hex.length >= 16) {
    const out = new Uint8Array(hex.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    return out;
  }
  if (typeof Buffer !== "undefined") return new Uint8Array(Buffer.from(t, "base64"));
  if (typeof atob === "function") {
    const bin = atob(t);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  throw new Error("MIDI 输入需十六进制或 base64");
}
function parseMidiFile(bytes) {
  let p = 0;
  const u32 = () => { const v = (bytes[p] << 24) | (bytes[p + 1] << 16) | (bytes[p + 2] << 8) | bytes[p + 3]; p += 4; return v >>> 0; };
  const u16 = () => { const v = (bytes[p] << 8) | bytes[p + 1]; p += 2; return v; };
  const str = (n) => { let s = ""; for (let i = 0; i < n; i++) s += String.fromCharCode(bytes[p++]); return s; };
  const vlq = () => { let v = 0, b; do { b = bytes[p++]; v = (v << 7) | (b & 0x7f); } while (b & 0x80); return v; };
  if (bytes.length < 14 || str(4) !== "MThd") throw new Error("不是 MIDI 文件（缺 MThd）");
  const hlen = u32();
  if (hlen < 6) throw new Error("MThd 长度异常");
  const format = u16(), ntrks = u16(), division = u16();
  p = 8 + hlen;
  if (division & 0x8000) throw new Error("暂不支持 SMPTE 时间基准");
  if (ntrks < 1 || ntrks > 64) throw new Error("音轨数需 1..64");
  const tracks = [];
  const tempos = [];
  let totalNotes = 0;
  while (p + 8 <= bytes.length && tracks.length < ntrks) {
    const id = str(4);
    const len = u32();
    if (id !== "MTrk") { p += len; continue; }
    const tend = p + len;
    let tick = 0, running = 0;
    const on = new Map();
    const notes = [];
    while (p < tend) {
      tick += vlq();
      let status = bytes[p++];
      if (status < 0x80) { p--; status = running; }
      else running = status;
      if (status === 0xff) {
        const type = bytes[p++];
        const l = vlq();
        if (type === 0x51 && l === 3) tempos.push({ tick, tempo: (bytes[p] << 16) | (bytes[p + 1] << 8) | bytes[p + 2] });
        p += l;
        continue;
      }
      if (status === 0xf0 || status === 0xf7) { p += vlq(); continue; }
      const hi = status & 0xf0, ch = (status & 0x0f) + 1;
      const d1 = bytes[p++];
      const d2 = hi === 0xc0 || hi === 0xd0 ? 0 : bytes[p++];
      const key = `${ch}:${d1}`;
      if (hi === 0x90 && d2 > 0) on.set(key, { tick, note: d1, vel: d2, ch });
      else if (hi === 0x80 || (hi === 0x90 && d2 === 0)) {
        const st = on.get(key);
        if (st) { notes.push({ ...st, end: tick }); on.delete(key); }
      }
      if (notes.length > 100000) throw new Error("音符超过 10 万，已中止");
    }
    for (const st of on.values()) notes.push({ ...st, end: tick });
    totalNotes += notes.length;
    if (totalNotes > 100000) throw new Error("音符超过 10 万，已中止");
    tracks.push(notes);
    p = tend;
  }
  tempos.sort((a, b) => a.tick - b.tick);
  const toSec = (tick) => {
    let us = 0, last = 0, tempo = 500000;
    for (const e of tempos) {
      if (e.tick > tick) break;
      us += (e.tick - last) * tempo / division;
      last = e.tick;
      tempo = e.tempo;
    }
    us += (tick - last) * tempo / division;
    return us / 1e6;
  };
  return { format, ntrks, division, tracks: tracks.map((notes) => notes.sort((a, b) => a.tick - b.tick || a.note - b.note).map((n) => ({ ...n, sec: toSec(n.tick), dur: toSec(n.end) - toSec(n.tick) }))) };
}
const opMidi = runOp(
  "d3-midi", CAT_TEXT,
  "MIDI 音符 / MIDI 文件提取 / 音名 / 频率",
  "MIDI 号 ↔ 音名（C4=60，A4=69=440Hz）与频率；支持升/降号与法语 solfège。file 模式解析标准 MIDI 文件（MThd/MTrk、VLQ、running status、Note On/Off、tempo map），输入十六进制或 base64。覆盖 Notes Midi；Notes de Musique 另行标注局限",
  (t, p) => {
    const mode = String((p && p.mode) || "note");
    const src = String(t || "").trim();
    if (!src) throw new Error("需要音名、MIDI 号或 MIDI 文件字节");
    const freq = (midi) => 440 * 2 ** ((midi - 69) / 12);
    if (mode === "file") {
      const mid = parseMidiFile(midiBytesFromInput(src));
      const lines = [`MIDI format ${mid.format}，${mid.ntrks} 轨，division=${mid.division} ticks/quarter`];
      mid.tracks.forEach((notes, ti) => {
        lines.push(`轨 ${ti}：${notes.length} 音符`);
        for (const n of notes.slice(0, 500)) {
          lines.push(`  ${NOTE_NAMES[n.note % 12]}${Math.floor(n.note / 12) - 1}  MIDI=${n.note} vel=${n.vel} ch=${n.ch} t=${n.sec.toFixed(3)}s dur=${n.dur.toFixed(3)}s`);
        }
        if (notes.length > 500) lines.push(`  …（截断到 500，共 ${notes.length}）`);
      });
      return lines.join("\n");
    }
    if (mode === "note" || mode === "all") {
      const midi = noteToMidi(src);
      return `${src.toUpperCase()} = MIDI ${midi} = ${NOTE_NAMES[midi % 12]}${Math.floor(midi / 12) - 1} = ${freq(midi).toFixed(3)} Hz`;
    }
    if (mode === "midi" || mode === "freq") {
      const midi = Number(src);
      if (!Number.isInteger(midi) || midi < 0 || midi > 127) throw new Error("MIDI 号需 0..127 整数");
      return `MIDI ${midi} = ${NOTE_NAMES[midi % 12]}${Math.floor(midi / 12) - 1} = ${freq(midi).toFixed(3)} Hz`;
    }
    throw new Error("模式支持 note/midi/freq/file");
  },
  [SEL("mode", "模式", "note", [{ value: "note", label: "音名→MIDI/频率" }, { value: "midi", label: "MIDI→音名" }, { value: "freq", label: "MIDI→频率" }, { value: "file", label: "MIDI 文件提取（hex/base64）" }])]
);

// =====================================================================================
// 32. 字符类型 / 特殊字符
// =====================================================================================
const opChartype = runOp(
  "d3-chartype", CAT_TEXT,
  "字符类型 / 特殊字符（Type de Caractères / Caractères Spéciaux）",
  "逐字符给出码位、字符类（大写/小写/数字/空白/标点/符号/组合/控制）与文字系统；特殊字符模式只列非字母数字。覆盖 Type de Caractères 与 Caractères Spéciaux",
  (t, p) => {
    const mode = String((p && p.mode) || "type");
    const s = String(t || "");
    if (!s) throw new Error("需要非空文本");
    const scriptOf = (cp) => {
      if (cp <= 0x024f) return "Latin";
      if (cp >= 0x0370 && cp <= 0x03ff) return "Greek";
      if (cp >= 0x0400 && cp <= 0x052f) return "Cyrillic";
      if (cp >= 0x0590 && cp <= 0x05ff) return "Hebrew";
      if (cp >= 0x0600 && cp <= 0x06ff) return "Arabic";
      if (cp >= 0x0900 && cp <= 0x097f) return "Devanagari";
      if (cp >= 0x0e00 && cp <= 0x0e7f) return "Thai";
      if ((cp >= 0x3040 && cp <= 0x30ff) || (cp >= 0x4e00 && cp <= 0x9fff)) return "CJK/Kana";
      if (cp >= 0xac00 && cp <= 0xd7af) return "Hangul";
      return "Other";
    };
    const classOf = (ch) => {
      if (/[A-Z]/.test(ch)) return "大写字母";
      if (/[a-zà-ÿ]/.test(ch)) return "小写字母";
      if (/\p{Lu}/u.test(ch)) return "大写字母";
      if (/\p{Ll}/u.test(ch)) return "小写字母";
      if (/\p{L}/u.test(ch)) return "字母";
      if (/\p{Nd}/u.test(ch)) return "数字";
      if (/\s/.test(ch)) return "空白";
      if (/\p{M}/u.test(ch)) return "组合符";
      if (/\p{P}/u.test(ch)) return "标点";
      if (/\p{S}/u.test(ch)) return "符号";
      if (/\p{C}/u.test(ch)) return "控制/格式";
      return "其他";
    };
    const chars = [...s];
    if (mode === "special") {
      const hits = chars.filter((ch) => !/[\p{L}\p{N}\s]/u.test(ch));
      return hits.length ? `非字母数字字符 ${hits.length} 个：\n` + [...new Set(hits)].map((ch) => `${ch}  U+${ch.codePointAt(0).toString(16).toUpperCase().padStart(4, "0")}  ${classOf(ch)}  ${scriptOf(ch.codePointAt(0))}`).join("\n") : "没有非字母数字字符";
    }
    if (mode === "count") {
      const m = new Map();
      for (const ch of chars) { const k = classOf(ch); m.set(k, (m.get(k) || 0) + 1); }
      return `总字符 ${chars.length}：\n${[...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}: ${v}`).join("\n")}`;
    }
    const uniq = [...new Set(chars)];
    if (uniq.length > 500) throw new Error("唯一字符超过 500，请缩小输入");
    return uniq.map((ch) => `${ch}  U+${ch.codePointAt(0).toString(16).toUpperCase().padStart(4, "0")}  ${classOf(ch)}  ${scriptOf(ch.codePointAt(0))}`).join("\n");
  },
  [SEL("mode", "模式", "type", [{ value: "type", label: "逐字符信息" }, { value: "count", label: "字符类计数" }, { value: "special", label: "只列特殊字符" }])]
);

// =====================================================================================
// 33. 可读性评分
// =====================================================================================
function countSyllables(word) {
  let w = word.toLowerCase().replace(/[^a-zà-ÿ]/g, "");
  if (!w) return 0;
  if (w.length <= 3) return 1;
  w = w.replace(/(?:[^laeiouyà-ÿ]es|ed|[^laeiouyà-ÿ]e)$/, "");
  w = w.replace(/^y/, "");
  const m = w.match(/[aeiouyà-ÿ]{1,3}/g);
  return m ? m.length : 1;
}
const opReadability = runOp(
  "d3-readability", CAT_TEXT,
  "可读性评分（Score de Lisibilité）",
  "Flesch（英/法）、Flesch-Kincaid、Gunning Fog、SMOG、ARI、Coleman-Liau；音节用规则启发式（非词典音节切分），输出各项分值与解释",
  (t, p) => {
    const s = String(t || "");
    if (!s.trim()) throw new Error("需要非空文本");
    const lang = String((p && p.lang) || "en");
    const wordsArr = s.match(/[A-Za-zÀ-ÿ]+/g) || [];
    if (!wordsArr.length) throw new Error("没有可统计的单词");
    const sentences = Math.max(1, (s.match(/[.!?。！？]+/g) || []).length);
    const words = wordsArr.length;
    const syllables = wordsArr.reduce((a, w) => a + countSyllables(w), 0) || 1;
    const complex = wordsArr.filter((w) => countSyllables(w) >= 3).length;
    const letters = (s.match(/[A-Za-zÀ-ÿ]/g) || []).length;
    const chars = wordsArr.join("").length;
    const flesch = (lang === "fr" ? 207 : 206.835) - 1.015 * (words / sentences) - (lang === "fr" ? 73.6 : 84.6) * (syllables / words);
    const fk = 0.39 * (words / sentences) + 11.8 * (syllables / words) - 15.59;
    const fog = 0.4 * ((words / sentences) + 100 * (complex / words));
    const smog = 1.043 * Math.sqrt(complex * 30 / sentences) + 3.1291;
    const ari = 4.71 * (chars / words) + 0.5 * (words / sentences) - 21.43;
    const cl = 0.0588 * (letters / words * 100) - 0.296 * (sentences / words * 100) - 15.8;
    const f = (x) => Number.isFinite(x) ? x.toFixed(2) : "—";
    return [
      `单词 ${words}，句子 ${sentences}，音节 ${syllables}，复杂词 ${complex}（≥3 音节）`,
      `Flesch Reading Ease（${lang === "fr" ? "法" : "英"}）= ${f(flesch)}`,
      `Flesch-Kincaid Grade = ${f(fk)}`,
      `Gunning Fog = ${f(fog)}`,
      `SMOG = ${f(smog)}`,
      `ARI = ${f(ari)}`,
      `Coleman-Liau = ${f(cl)}`,
      "（音节为规则启发式，专名/缩写会偏差；用于相对比较）",
    ].join("\n");
  },
  [SEL("lang", "语言", "en", [{ value: "en", label: "英语" }, { value: "fr", label: "法语" }])]
);

// =====================================================================================
// 34. 可打印字符串提取
// =====================================================================================
const opStrings = runOp(
  "d3-strings", CAT_TEXT,
  "可打印字符串提取（Extracteur de Chaines）",
  "从文本/十六进制字节中提取连续可打印 ASCII（0x20–0x7E）片段，长度 ≥N（默认 4），给出偏移。覆盖 strings 类提取；不做 UTF-16/自动编码猜测",
  (t, p) => {
    const min = Math.max(1, Math.min(100, Number((p && p.min) || 4) || 4));
    const enc = String((p && p.enc) || "text");
    let s = String(t || "");
    if (enc === "hex") {
      const hex = s.replace(/[^0-9a-fA-F]/g, "");
      if (hex.length % 2 !== 0) throw new Error("十六进制长度需为偶数");
      s = "";
      for (let i = 0; i < hex.length; i += 2) s += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
    }
    const out = [];
    let cur = "", start = 0;
    for (let i = 0; i <= s.length; i++) {
      const c = i < s.length ? s.charCodeAt(i) : 0;
      if (c >= 0x20 && c <= 0x7e) {
        if (!cur) start = i;
        cur += s[i];
      } else {
        if (cur.length >= min) out.push(`0x${start.toString(16).padStart(4, "0")}\t${cur}`);
        cur = "";
      }
    }
    return out.length ? `可打印字符串 ${out.length} 段（≥${min}）：\n${out.join("\n")}` : `没有长度 ≥${min} 的可打印 ASCII 片段`;
  },
  [P("min", "最短长度", "4"), SEL("enc", "输入编码", "text", [{ value: "text", label: "文本" }, { value: "hex", label: "十六进制字节" }])]
);

// =====================================================================================
// 35. 虚构身份 / 假名
// =====================================================================================
const FIRST_EN = ["Alice", "Bob", "Carol", "David", "Emma", "Frank", "Grace", "Henry", "Iris", "Jack"];
const LAST_EN = ["Smith", "Johnson", "Brown", "Taylor", "Miller", "Wilson", "Davis", "Clark", "Lewis", "Walker"];
const FIRST_FR = ["Alice", "Bruno", "Chloé", "David", "Élodie", "François", "Gaëlle", "Hugo", "Inès", "Julien"];
const LAST_FR = ["Martin", "Bernard", "Dubois", "Thomas", "Robert", "Richard", "Petit", "Durand", "Leroy", "Moreau"];
const CITIES = ["Paris", "Lyon", "Marseille", "Toulouse", "Nantes", "Lille", "Bordeaux", "Nice"];
const STREETS = ["rue des Lilas", "avenue Victor Hugo", "boulevard Saint-Michel", "place de la République", "chemin des Vignes"];
const opFakeId = runOp(
  "d3-fakeid", CAT_TEXT,
  "虚构身份 / 假名生成（Fausse Identité / Pseudo）",
  "生成明确标注为虚构的姓名、出生日期、地址、邮箱、电话与昵称；使用统一随机源。覆盖 Générateur de Fausse Identité 与 Générateur de Pseudo",
  (t, p) => {
    const mode = String((p && p.mode) || "identity");
    const lang = String((p && p.lang) || "fr");
    const n = Math.max(1, Math.min(20, Number((p && p.n) || 1) || 1));
    const first = lang === "fr" ? FIRST_FR : FIRST_EN;
    const last = lang === "fr" ? LAST_FR : LAST_EN;
    const out = [];
    for (let k = 0; k < n; k++) {
      const fn = first[randInt(first.length)], ln = last[randInt(last.length)];
      if (mode === "pseudo") {
        out.push(`${FAKE_ADJ[randInt(FAKE_ADJ.length)]}${FAKE_NOUN[randInt(FAKE_NOUN.length)]}${randInt(1000)}`);
      } else {
        const y = 1960 + randInt(45), mo = 1 + randInt(12), d = 1 + randInt(28);
        const dom = lang === "fr" ? "example.fr" : "example.com";
        out.push([
          `姓名：${fn} ${ln}`,
          `出生：${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`,
          `地址：${1 + randInt(200)} ${STREETS[randInt(STREETS.length)]}, ${CITIES[randInt(CITIES.length)]}`,
          `邮箱：${fn.toLowerCase()}.${ln.toLowerCase()}${randInt(100)}@${dom}`,
          `电话：+33 6 ${String(randInt(100)).padStart(2, "0")} ${String(randInt(100)).padStart(2, "0")} ${String(randInt(100)).padStart(2, "0")} ${String(randInt(100)).padStart(2, "0")}`,
        ].join("\n"));
      }
    }
    return `（虚构数据，仅用于演示/测试，非真实身份）\n${out.join("\n---\n")}`;
  },
  [SEL("mode", "模式", "identity", [{ value: "identity", label: "虚构身份" }, { value: "pseudo", label: "随机假名" }]), SEL("lang", "语言", "fr", [{ value: "fr", label: "法语" }, { value: "en", label: "英语" }]), P("n", "数量 ≤20", "1")]
);

// =====================================================================================
// 36. 密码变体
// =====================================================================================
const LEET_MAP = { a: "@", e: "3", i: "1", o: "0", s: "$", t: "7", l: "1", g: "9", b: "8" };
const opPassvariants = runOp(
  "d3-passvariants", CAT_TEXT,
  "密码变体生成（Variations de Mot de Passe）",
  "由基础密码生成大小写、leet、追加年份/数字/符号的常见变体，去重后上限 500；用于字典测试，不保证覆盖全部规则",
  (t, p) => {
    const base = String(t || "").trim();
    if (!base || base.length > 64) throw new Error("需要 1..64 字符的基础密码");
    const cap = Math.min(500, Math.max(1, Number((p && p.max) || 300) || 300));
    const leet = (s) => [...s].map((c) => LEET_MAP[c.toLowerCase()] || c).join("");
    const out = new Set([base, base.toLowerCase(), base.toUpperCase(), base[0].toUpperCase() + base.slice(1)]);
    out.add([...base].reverse().join(""));
    out.add(leet(base));
    out.add(leet(base[0].toUpperCase() + base.slice(1)));
    for (const c of "0123456789") out.add(base + c);
    for (const c of "0123456789") out.add(base[0].toUpperCase() + base.slice(1) + c);
    for (const y of ["2020", "2021", "2022", "2023", "2024", "2025", "2026"]) out.add(base + y);
    for (const sym of ["!", "@", "#", "$", "?", "*", "_", "-"]) out.add(base + sym);
    const arr = [...out].filter((x) => x.length <= 80).slice(0, cap);
    return `基础「${base}」变体 ${arr.length} 个${out.size > cap ? "（截断到 " + cap + "）" : ""}：\n${arr.join("\n")}`;
  },
  [P("max", "上限 ≤500", "300")]
);

// =====================================================================================
// 37. 同形异义字生成
// =====================================================================================
const HOMOGLYPH = { a: "а", c: "с", e: "е", o: "о", p: "р", x: "х", y: "у", i: "і", j: "ј", s: "ѕ", h: "һ", d: "ԁ", q: "ԛ", w: "ԝ", A: "А", B: "В", C: "С", E: "Е", H: "Н", I: "І", J: "Ј", K: "К", M: "М", O: "О", P: "Р", S: "Ѕ", T: "Т", X: "Х", Y: "У" };
const HOMOGLYPH_REV = new Map(Object.entries(HOMOGLYPH).map(([k, v]) => [v, k]));
const opHomoglyph = runOp(
  "d3-homoglyph", CAT_TEXT,
  "同形异义字生成（Homoglyphes / Homographes）",
  "把拉丁字母替换为视觉相近的西里尔字母（а/е/о/р/с/х…），可逆；用于演示同形字混淆。不是完整 Unicode confusables 全集",
  (t, p) => {
    const dir = String((p && p.dir) || "encode");
    const s = String(t || "");
    if (!s) throw new Error("需要非空文本");
    if (dir === "decode") return [...s].map((c) => HOMOGLYPH_REV.get(c) ?? c).join("");
    let out = "";
    for (const c of s) out += HOMOGLYPH[c] ?? c;
    return out;
  },
  [SEL("dir", "方向", "encode", [{ value: "encode", label: "拉丁→同形字" }, { value: "decode", label: "同形字→拉丁" }])]
);

// =====================================================================================
// 38. 迷宫生成
// =====================================================================================
const opMaze = runOp(
  "d3-maze", CAT_TEXT,
  "迷宫生成（Générateur de Labyrinthe）",
  "DFS 生成 perfect maze：宽 w、高 h（2..30），输出 (2h+1)×(2w+1) ASCII 图，#=墙、空格=通路；左上入口、右下出口",
  (t, p) => {
    const w = Math.max(2, Math.min(30, Number((p && p.w) || t) || 10));
    const h = Math.max(2, Math.min(30, Number((p && p.h) || 10) || 10));
    if (!Number.isInteger(w) || !Number.isInteger(h)) throw new Error("宽高需整数 2..30");
    const W = 2 * w + 1, H = 2 * h + 1;
    const g = Array.from({ length: H }, () => new Array(W).fill("#"));
    const seen = Array.from({ length: h }, () => new Array(w).fill(false));
    const stack = [[0, 0]];
    seen[0][0] = true;
    g[1][1] = " ";
    const dirs = [[0, 1], [1, 0], [0, -1], [-1, 0]];
    while (stack.length) {
      const [r, c] = stack[stack.length - 1];
      const opts = [];
      for (const [dr, dc] of dirs) {
        const nr = r + dr, nc = c + dc;
        if (nr >= 0 && nc >= 0 && nr < h && nc < w && !seen[nr][nc]) opts.push([nr, nc, dr, dc]);
      }
      if (!opts.length) { stack.pop(); continue; }
      const [nr, nc, dr, dc] = opts[randInt(opts.length)];
      seen[nr][nc] = true;
      g[1 + r * 2 + dr][1 + c * 2 + dc] = " ";
      g[1 + nr * 2][1 + nc * 2] = " ";
      stack.push([nr, nc]);
    }
    g[1][0] = " ";
    g[H - 2][W - 1] = " ";
    return `${w}×${h} perfect maze：\n${g.map((r) => r.join("")).join("\n")}`;
  },
  [P("w", "宽（格）", "10"), P("h", "高（格）", "10")]
);

// =====================================================================================
// 39. 混成词（Mot-Valise）
// =====================================================================================
const opPortmanteau = runOp(
  "d3-portmanteau", CAT_TEXT,
  "混成词生成（Générateur de Mot-Valise）",
  "两个词用 + 或逗号分隔；找两者之间的最长公共子串，按 A 前缀 + 公共段 + B 后缀（及反向）生成候选，如 smoke+fog → smog",
  (t, p) => {
    const parts = String(t || "").split(/[+,]/).map((s) => s.trim().toLowerCase()).filter(Boolean);
    if (parts.length !== 2) throw new Error("格式：smoke+fog（两个词）");
    const [a, b] = parts;
    if (!/^[a-zà-ÿ]+$/.test(a) || !/^[a-zà-ÿ]+$/.test(b)) throw new Error("两个词都需纯字母");
    const out = new Set();
    for (let len = Math.min(a.length, b.length); len >= 1; len--) {
      for (let i = 0; i + len <= a.length; i++) {
        const sub = a.slice(i, i + len);
        const j = b.indexOf(sub);
        if (j < 0) continue;
        const cand = a.slice(0, i) + sub + b.slice(j + len);
        if (cand.length >= 3 && cand !== a && cand !== b) out.add(cand);
      }
    }
    return out.size ? `「${a}」+「${b}」候选 ${out.size} 个：\n${[...out].sort().join("\n")}` : "两词没有可用的公共片段";
  }
);

// =====================================================================================
// 40. 生命游戏
// =====================================================================================
const opLife = runOp(
  "d3-life", CAT_TEXT,
  "生命游戏（Jeu de la Vie）",
  "Conway 生命游戏：输入 0/1 或 . / # 网格，迭代 N 代（≤1000），输出最终盘面；边界外视为死细胞",
  (t, p) => {
    const rows = String(t || "").split(/\r?\n/).map((r) => r.trim()).filter(Boolean);
    if (rows.length < 2 || rows.length > 100) throw new Error("网格需 2..100 行");
    const C = rows[0].length;
    if (C < 2 || C > 100 || !rows.every((r) => r.length === C)) throw new Error("每行等长，宽 2..100");
    let g = rows.map((r) => [...r].map((c) => (c === "1" || c === "#" || c === "O" ? 1 : 0)));
    const gens = Math.max(0, Math.min(1000, Number((p && p.gens) || 10) || 10));
    for (let step = 0; step < gens; step++) {
      const ng = Array.from({ length: g.length }, () => new Array(C).fill(0));
      for (let r = 0; r < g.length; r++) for (let c = 0; c < C; c++) {
        let n = 0;
        for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
          if (!dr && !dc) continue;
          const nr = r + dr, nc = c + dc;
          if (nr >= 0 && nc >= 0 && nr < g.length && nc < C) n += g[nr][nc];
        }
        ng[r][c] = g[r][c] ? (n === 2 || n === 3 ? 1 : 0) : (n === 3 ? 1 : 0);
      }
      g = ng;
    }
    return `迭代 ${gens} 代（${g.length}×${C}）：\n${g.map((r) => r.map((v) => (v ? "#" : ".")).join("")).join("\n")}`;
  },
  [P("gens", "迭代代数 ≤1000", "10")]
);

// =====================================================================================
// 41. 计算填空（Calculs à Trous）
// =====================================================================================
function evalArith(expr) {
  const toks = String(expr).replace(/\s+/g, "").match(/\d+(?:\.\d+)?|[+\-*/()]/g);
  if (!toks || toks.join("") !== String(expr).replace(/\s+/g, "")) throw new Error("表达式含无法识别字符");
  let i = 0;
  const peek = () => toks[i];
  const eat = (t) => { if (toks[i] === t) { i++; return true; } return false; };
  const parseExpr = () => {
    let v = parseTerm();
    while (peek() === "+" || peek() === "-") { const op = toks[i++]; const r = parseTerm(); v = op === "+" ? v + r : v - r; }
    return v;
  };
  const parseTerm = () => {
    let v = parseFactor();
    while (peek() === "*" || peek() === "/") {
      const op = toks[i++];
      const r = parseFactor();
      if (op === "/" && r === 0) throw new Error("除数为 0");
      v = op === "*" ? v * r : v / r;
    }
    return v;
  };
  const parseFactor = () => {
    if (eat("-")) return -parseFactor();
    if (eat("(")) { const v = parseExpr(); if (!eat(")")) throw new Error("括号不匹配"); return v; }
    const tok = toks[i++];
    if (!tok || !/^\d+(?:\.\d+)?$/.test(tok)) throw new Error("缺少数字");
    return Number(tok);
  };
  const v = parseExpr();
  if (i !== toks.length) throw new Error("表达式未完全解析");
  return v;
}
const opHolecalc = runOp(
  "d3-holecalc", CAT_NUM,
  "计算填空（Calculs à Trous）",
  "等式中的 ? 用数字（0..99）或运算符（+ − * /）填入，枚举全部解。支持 + − * / 与括号；数字模式最多 3 个空（100³）、运算符模式最多 6 个空",
  (t, p) => {
    const src = String(t || "").replace(/×/g, "*").replace(/÷/g, "/").replace(/−/g, "-").trim();
    const m = src.match(/^([^=]+)=([^=]+)$/);
    if (!m) throw new Error("格式：3 ? 4 = 7（必须有一个 =）");
    const lhs = m[1], rhs = m[2];
    const holes = (lhs + rhs).split("?").length - 1;
    if (!holes) throw new Error("至少一个 ?");
    const mode = String((p && p.mode) || "numbers");
    const out = [];
    if (mode === "operators") {
      if (holes > 6) throw new Error("运算符空最多 6 个");
      const ops = ["+", "-", "*", "/"];
      for (let n = 0; n < 4 ** holes; n++) {
        let x = n, k = 0;
        const rep = () => { const o = ops[x % 4]; x = Math.floor(x / 4); k++; return o; };
        const a = lhs.replace(/\?/g, rep), b = rhs.replace(/\?/g, rep);
        try {
          if (Math.abs(evalArith(a) - evalArith(b)) < 1e-9) out.push(`${a} = ${b}`);
        } catch { /* 跳过非法式子 */ }
      }
    } else {
      if (holes > 3) throw new Error("数字空最多 3 个（100³ = 1e6 枚举）");
      for (let n = 0; n < 100 ** holes; n++) {
        let x = n;
        const rep = () => { const v = x % 100; x = Math.floor(x / 100); return String(v); };
        const a = lhs.replace(/\?/g, rep), b = rhs.replace(/\?/g, rep);
        try {
          if (Math.abs(evalArith(a) - evalArith(b)) < 1e-9) out.push(`${a} = ${b}`);
          if (out.length > 2000) throw new Error("解超过 2000，请缩小范围");
        } catch (e) { if (String(e.message).includes("超过 2000")) throw e; }
      }
    }
    return out.length ? `填空解 ${out.length} 个：\n${out.slice(0, 200).map((x) => x.replace(/\s+/g, " ").replace(/\s*=\s*/g, " = ")).join("\n")}` : "无解（在允许的填充范围内）";
  },
  [SEL("mode", "填什么", "numbers", [{ value: "numbers", label: "数字 0..99" }, { value: "operators", label: "运算符 + - * /" }])]
);

export const OPS = [
  opBoggle, opWordfind, opSpellingbee, opLetterboxed, opWordextend, opAnacyclic,
  opWordpyramid, opMissingletters, opWordregex, opWordorder, opJotto, opMotus,
  opPhrasefilter, opWordsearch, opAnagramGen, opPalindromeGen, opRandom, opCard, opMastermind,
  opMagicSquare, opCountdown, opSudokuN, opCalcspell, opConstants, opBirthday,
  opZodiac, opDate, opLatinDate, opTimeDilation, opAmi, opChess, opMidi,
  opChartype, opReadability, opStrings, opFakeId, opPassvariants, opHomoglyph,
  opMaze, opPortmanteau, opLife, opHolecalc,
];

// =====================================================================================
// 覆盖台账：264 个 dCode 工具条目逐条判定
// implemented = 本批 d3-* op 直接实现核心；
// mapped      = 本插件既有 op 或主程序 op 已覆盖（括注的局限如实写明）；
// blocked     = 需图片/OCR/音频/外部网络/专有规则库或未公开规范，未伪造。
// =====================================================================================
const CATALOG = [
  ["Jeux de Société", `
    Boggle 4x4|solveur-boggle-4x4
    Cartes à Jouer|cartes-a-jouer
    Notation Algébrique aux Echecs|notation-san-echecs
    Notation Echecs UCI|notation-echecs-uci
    Notation Forsyth-Edwards|notation-echecs-fen
    Roue de la Fortune|solveur-roue-de-la-fortune
    Solveur Bulls and Cows|solveur-bulls-and-cows
    Solveur Fling|solveur-fling
    Solveur Mastermind|solveur-mastermind
    Solveur Wordox|solveur-wordox
    Solveur de Big Boggle 5x5|solveur-big-boggle-5x5
    Solveur de Boggle (Toutes Tailles)|solveur-boggle-nxn
    Solveur de Popotamo|solveur-popotamo
    Solveur de Scrabble|solveur-scrabble
    Solveur de Set|solveur-set
    Solveur de Squaredle|solveur-squaredle
    Solveur de Super Big Boggle 6x6|solveur-super-big-boggle-6x6
    Solveur de Taquin|solveur-taquin
    Solveur de Taquin 3x3|solveur-taquin-3x3
    Solveur de Taquin 4x4|solveur-taquin-4x4
    Solveur de Taquin 5x5|solveur-taquin-5x5
    Solveur de Tour de Hanoï|solveur-tour-de-hanoi
  `],
  ["Jeux sur Mobile", `
    Solveur AlphaBetty|solveur-alphabetty
    Solveur Aworded|solveur-aworded
    Solveur Lights Out|solveur-lights-out
    Solveur Pixwords|solveur-pixwords
    Solveur Quel Est le Mot|solveur-quel-est-le-mot
    Solveur Word Cookies|solveur-word-cookies
    Solveur Wordament|solveur-wordament
    Solveur de Boggle/Word Streak|solveur-word-streak-with-friends
    Solveur de Codycross|solveur-codycross
    Solveur de Ruzzle|solveur-ruzzle
    Solveur de Word Bites (Game Pigeon)|solveur-word-bites-game-pigeon
    Solveur de Word Hunt (Game Pigeon)|solveur-word-hunt-game-pigeon
    Solveur de Wordfeud|solveur-wordfeud
  `],
  ["Jeux de Lettres", `
    Addition de Mots|addition-mots
    Ajouter des Lettres à un Mot|ajout-lettre-mot
    Alphamo|solveur-alphamo
    Blossom|solveur-blossom
    Boggle 4x4|solveur-boggle-4x4
    Carte à Jouer Aléatoire|carte-a-jouer-aleatoire
    Changement de Lettre dans un Mot|changement-lettre-mot
    Consonnes Manquantes|consonnes-manquantes
    Echelle de Mots|echelle-mots
    Générateur d'Anacycliques|generateur-anacycliques
    Générateur d'Anagrammes|generateur-anagrammes
    Générateur d'Autogramme|generateur-auto-description
    Générateur de Palindromes|generateur-palindromes
    Harry - Le Jeu|harry-jeu
    Letter Boxed|solveur-letter-boxed
    Lettre Aléatoire|lettre-aleatoire
    Lettres Mélangées|lettres-melangees
    Mot Aléatoire|mot-aleatoire
    Mélangeur de Mots|melangeur-mots
    Prolonger un Mot|prolongement-mot
    Pyramide de Mots|pyramide-mots
    Retirer des Lettres à un Mot|retrait-lettre-mot
    Roue de la Fortune|solveur-roue-de-la-fortune
    Solveur 4 Images 1 Mot|solveur-4-images-1-mot
    Solveur AlphaBetty|solveur-alphabetty
    Solveur Aworded|solveur-aworded
    Solveur Figguess|solveur-figguess
    Solveur Jardin des Mots|solveur-jardin-des-mots
    Solveur Jotto|solveur-jotto
    Solveur Le Mot le Plus Long|solveur-mot-le-plus-long
    Solveur Maitre des Mots|solveur-maitre-des-mots
    Solveur Pixwords|solveur-pixwords
    Solveur Pro des Mots|solveur-pro-des-mots
    Solveur Word Blitz|solveur-wordblitz
    Solveur Word Cookies|solveur-word-cookies
    Solveur Word Cross|solveur-word-cross
    Solveur Word Snack|solveur-word-snack
    Solveur Wordalot|solveur-wordalot
    Solveur Wordament|solveur-wordament
    Solveur Wordington|solveur-wordington
    Solveur Wordox|solveur-wordox
    Solveur Wordscapes|solveur-wordscapes
    Solveur de Big Boggle 5x5|solveur-big-boggle-5x5
    Solveur de Boggle (Toutes Tailles)|solveur-boggle-nxn
    Solveur de Boggle/Word Streak|solveur-word-streak-with-friends
    Solveur de Charme des Mots|solveur-charme-des-mots
    Solveur de Codycross|solveur-codycross
    Solveur de Mots-Croisés|solveur-mots-croises
    Solveur de Mots-Mêlés|solveur-mots-meles
    Solveur de Mots Couplés|solveur-mots-couples
    Solveur de Mots entre Amis|solveur-mots-entre-amis
    Solveur de Motus/Sutom/Tusmo|solveur-motus
    Solveur de Nombres Mêlés|solveur-nombres-meles
    Solveur de Pendu|solveur-pendu
    Solveur de Popotamo|solveur-popotamo
    Solveur de Ruzzle|solveur-ruzzle
    Solveur de Scrabble|solveur-scrabble
    Solveur de Squaredle|solveur-squaredle
    Solveur de Super Big Boggle 6x6|solveur-super-big-boggle-6x6
    Solveur de Word Academy|solveur-word-academy
    Solveur de Word Bites (Game Pigeon)|solveur-word-bites-game-pigeon
    Solveur de WordBrain|solveur-wordbrain
    Solveur de WordBubbles|solveur-word-bubbles
    Solveur de Word Hunt (Game Pigeon)|solveur-word-hunt-game-pigeon
    Solveur de Wordfeud|solveur-wordfeud
    Solveur de Wordle|solveur-wordle
    Spelling Bee|solveur-spelling-bee
    Voyelles Manquantes|voyelles-manquantes
    What's the Phrase|solveur-what-the-phrase
  `],
  ["Jeux de Nombres", `
    Carré Latin|carre-latin
    Carré Magique|carre-magique
    Ecriture Calculette BEGHILOS|ecriture-beghilos
    Ecriture Calculette TI-30|ecriture-ti-30
    Générateur d'Autogramme|generateur-auto-description
    Le Compte Est Bon|compte-est-bon
    Nombre de Lychrel|nombre-lychrel
    Racine Numérique|reduction-recursive
    Solveur 24|solveur-24-jeu
    Solveur All Ten|solveur-all-ten
    Solveur Binairo|solveur-binairo
    Solveur Binoxxo|solveur-binoxxo
    Solveur Cryptarithme|solveur-cryptarithme
    Solveur Fill-A-Pix|solveur-fill-a-pix
    Solveur Hexadoku (Sudoku 16x16)|solveur-hexadoku-sudoku-16
    Solveur Krypto|solveur-krypto
    Solveur Mathador|solveur-mathador
    Solveur Picture Sweep|solveur-picture-sweep
    Solveur Sudoku|solveur-sudoku
    Solveur Sudoku 4x4|solveur-sudoku-4x4
    Solveur Sudoku 5x5|solveur-sudoku-5x5
    Solveur Sudoku 6x6|solveur-sudoku-6x6
    Solveur Sudoku 7x7|solveur-sudoku-7x7
    Solveur Sudoku 8x8|solveur-sudoku-8x8
    Solveur Sudoku 10x10|solveur-sudoku-10
    Solveur Sudoku NxN Irrégulier|solveur-sudoku-irregulier
    Solveur Sudozen (Sudoku 12x12)|solveur-sudoku-12x12
    Solveur Takuzu|solveur-takuzu
    Solveur Tectonic|solveur-tectonic
    Solveur Wordoku|solveur-wordoku
    Solveur de Calculs à Trous|solveur-calculs-a-trous
    Solveur de Calculs à Trous (Nombres)|solveur-calculs-a-trous-nombres
    Solveur de Calculs à Trous (Opérateurs)|solveur-calculs-a-trous-operateurs
    Solveur de Kakuro|solveur-kakuro
    Solveur de Taquin|solveur-taquin
    Solveur de Taquin 3x3|solveur-taquin-3x3
    Solveur de Taquin 4x4|solveur-taquin-4x4
    Solveur de Taquin 5x5|solveur-taquin-5x5
    Somme de Chiffres|somme-chiffres
    Valeur d'un Mot|valeur-mot
  `],
  ["Recherche de Mots", `
    Ajouter des Lettres à un Mot|ajout-lettre-mot
    Changement de Lettre dans un Mot|changement-lettre-mot
    Clé de Transposition|cle-transposition
    Générateur d'Anagrammes|generateur-anagrammes
    Heterogramme|heterogramme
    Isogramme|isogramme
    Mot Précédent|mot-prececent
    Mot Suivant|mot-suivant
    Mots Commençant par…|mots-commencant-par
    Mots Contenant …|mots-contenant
    Mots Finissant par…|mots-finissant-par
    Recherche de Mot|recherche-mot
    Recherche de Mot par Motif|recherche-mot-motif
    Recherche de Mot par Regex|recherche-mot-regexp
    Retirer des Lettres à un Mot|retrait-lettre-mot
  `],
  ["Internet", `
    Adresse IP|adresse-ip
    Chiffre ROT-47|chiffre-rot-47
    Codage Unicode|codage-unicode
    Code Base64|code-base-64
    Couleurs HTML|couleurs-html
    Décodage d'URL|decodage-url
    Ecriture 1337 Leet Speak|ecriture-1337-leet-speak
    Enregistrements DNS|enregistrements-dns
    Générateur de Fausse Identité|generateur-fausse-identite
    Générateur de Pseudo|generateur-pseudonyme
    HTML Escape|echappement-html
    Variations de Mot de Passe|variation-mot-passe
  `],
  ["Télécommunication", `
    Code Alternate Mark Inversion|code-alternate-mark-inversion
    Code Baudot|code-baudot
    Code DTMF (FV)|code-dtmf
    Code Decabit|code-decabit
    Code Manchester|code-manchester
    Code Morse|code-morse
    Code T9 (SMS)|code-t9
    Code Téléphone Multi-tap (SMS)|code-multitap-abc
    Code Wabun|code-wabun
    Code de Clavier de Téléphone|code-clavier-telephone
    Géolocalisation d'un Numéro de Téléphone|geolocalisation-numero-telephone
  `],
  ["Traitement de Texte", `
    Accents et Diacritiques|supprimer-accents-diacritiques
    Caractères Spéciaux|caracteres-speciaux
    Extracteur de Chaines|extracteur-chaines
    Longueur de Texte|longueur-texte
    Score de Lisibilité|test-lisibilite
    Type de Caractères|type-caracteres
    Typoglycémie|generateur-typoglycemie
  `],
  ["Fun/Divers", `
    Accent Allemand|accent-allemand
    Accent Anglais|accent-anglais
    Accent Asiatique|accent-asiatique
    Accent Espagnol|accent-hispanique
    Accent Etranger|accent-etranger
    Accent Français|accent-francais
    Accent Italien|accent-italien
    Accent Russe|accent-russe
    Caractères des Alphabets Etrangers|alphabets-caracteres-latins-etrangers
    Carré Magique|carre-magique
    Carte d'Identité Européenne|carte-identite-europenne
    Carte d'Identité Française|carte-identite-francaise
    Carte à Jouer Aléatoire|carte-a-jouer-aleatoire
    Chiffres Aléatoires|chiffre-aleatoire
    Chiffres Miroir|chiffres-miroir
    Code Bibi-binaire|code-bibi-binaire
    Conjecture de Syracuse|conjecture-syracuse
    Date en Latin|date-latin
    Dominos en Chiffres|lecteur-domino
    Décimales de Pi 3.14159…|decimales-pi
    Décimales de Tau τ=6.2831853…|decimales-tau
    Décimales de e 2.71828...|decimales-e
    Décimales du Nombre d'Or Phi 1.61803...|decimales-nombre-or
    Ecriture 1337 Leet Speak|ecriture-1337-leet-speak
    Ecriture Calculette BEGHILOS|ecriture-beghilos
    Ecriture Calculette TI-30|ecriture-ti-30
    Ecriture Dotsies|ecriture-dotsies
    Ecriture Spéculaire (en Miroir)|ecriture-speculaire-miroir
    Ecriture en Sens Inverse > esrevnI|ecriture-sens-inverse
    Ecriture à l'Envers > sɹǝʌuƎ|ecriture-a-l-envers
    Générateur d'Homoglyphes/Homographes|generateur-homoglyphes-homographes
    Générateur de Fausse Identité|generateur-fausse-identite
    Générateur de Labyrinthe|generateur-labyrinthe
    Générateur de Mot-Valise|generateur-mot-valise
    Générateur de Pseudo|generateur-pseudonyme
    Heterogramme|heterogramme
    Isogramme|isogramme
    Jeu de la Vie|jeu-de-la-vie
    Jour de la Semaine d'une Date|jour-semaine-date
    Langage de Shankar (Slumdog Millionnaire)|langage-shankar
    Lettre Aléatoire|lettre-aleatoire
    Majuscule et Minuscule|majuscules-minuscules
    Mot Aléatoire|mot-aleatoire
    Mélangeur de Mots|melangeur-mots
    Nombre de Lychrel|nombre-lychrel
    Nombres Aléatoires|nombre-aleatoire
    Numération Shadoks|numeration-shadok
    Numérologie Chaldéenne|numerologie-chaldeenne
    Numérologie Gematria|numerologie-gematria
    Numérologie Isopséphie|numerologie-isopsephie
    Numérologie de Pythagore|numerologie-pythagore
    Probabilités d'Anniversaire|probabilites-anniversaire
    Recherche dans les Décimales|recherche-decimales
    Rotation du Cube|rotation-cube
    Signe Astrologique|signe-astrologique
    Signe Astrologique Chinois|signe-astrologique-chinois
    Suite de Conway|suite-conway
    Séparateur de Syllabes|separateur-syllabes
    Tirage au Sort|tirage-au-sort
  `],
  ["Date et Temps", `
    Calcul avec des Dates|calcul-date
    Date en Latin|date-latin
    Différence entre 2 Dates|difference-date
    Dilatation du Temps|dilatation-temps
    Format de Date|format-date
    Jour de la Semaine d'une Date|jour-semaine-date
    Nième Jour de l'Année|nieme-jour-annee
    Siècle d'une Année|siecles
    Timestamp|convertisseur-timestamp
    Timestamp Windows|timestamp-windows
  `],
  ["Musique", `
    Chiffre par Partition Musicale|chiffre-partition-musicale
    Code Acéré|chiffre-acere
    Notation des Accords de Guitare|notation-accords-guitare
    Notes Midi|notes-midi
    Notes de Musique|notes-musique
    Partition/Portée de Musique|partition-musique
  `],
];

const IMPLEMENTED = new Map([
  ["Boggle 4x4", "d3-boggle"],
  ["Cartes à Jouer", "d3-card"],
  ["Notation Algébrique aux Echecs", "d3-chess"],
  ["Notation Echecs UCI", "d3-chess"],
  ["Notation Forsyth-Edwards", "d3-chess"],
  ["Roue de la Fortune", "d3-phrasefilter"],
  ["Solveur Mastermind", "d3-mastermind"],
  ["Solveur de Big Boggle 5x5", "d3-boggle"],
  ["Solveur de Boggle (Toutes Tailles)", "d3-boggle"],
  ["Solveur de Squaredle", "d3-boggle"],
  ["Solveur de Super Big Boggle 6x6", "d3-boggle"],
  ["Solveur Word Cookies", "d3-wordfind"],
  ["Solveur Wordament", "d3-boggle"],
  ["Solveur de Boggle/Word Streak", "d3-boggle"],
  ["Solveur de Ruzzle", "d3-boggle"],
  ["Solveur de Word Bites (Game Pigeon)", "d3-wordfind"],
  ["Solveur de Word Hunt (Game Pigeon)", "d3-boggle"],
  ["Ajouter des Lettres à un Mot", "d3-wordextend"],
  ["Blossom", "d3-spellingbee"],
  ["Carte à Jouer Aléatoire", "d3-random"],
  ["Changement de Lettre dans un Mot", "d3-wordextend"],
  ["Consonnes Manquantes", "d3-missingletters"],
  ["Générateur d'Anacycliques", "d3-anacyclic"],
  ["Générateur d'Anagrammes", "d3-anagram-gen"],
  ["Générateur de Palindromes", "d3-palindrome-gen"],
  ["Letter Boxed", "d3-letterboxed"],
  ["Lettre Aléatoire", "d3-random"],
  ["Mot Aléatoire", "d3-random"],
  ["Prolonger un Mot", "d3-wordextend"],
  ["Pyramide de Mots", "d3-wordpyramid"],
  ["Retirer des Lettres à un Mot", "d3-wordextend"],
  ["Solveur Jardin des Mots", "d3-wordfind"],
  ["Solveur Jotto", "d3-jotto"],
  ["Solveur Maitre des Mots", "d3-wordfind"],
  ["Solveur Pro des Mots", "d3-wordfind"],
  ["Solveur Word Blitz", "d3-boggle"],
  ["Solveur Word Cross", "d3-wordfind"],
  ["Solveur Word Snack", "d3-wordfind"],
  ["Solveur Wordington", "d3-wordfind"],
  ["Solveur Wordscapes", "d3-wordfind"],
  ["Solveur de Charme des Mots", "d3-wordfind"],
  ["Solveur de Mots-Mêlés", "d3-wordsearch"],
  ["Solveur de Motus/Sutom/Tusmo", "d3-motus"],
  ["Solveur de Nombres Mêlés", "d3-wordsearch"],
  ["Solveur de Word Academy", "d3-wordfind"],
  ["Solveur de WordBrain", "d3-boggle"],
  ["Solveur de WordBubbles", "d3-wordfind"],
  ["Spelling Bee", "d3-spellingbee"],
  ["Voyelles Manquantes", "d3-missingletters"],
  ["What's the Phrase", "d3-phrasefilter"],
  ["Carré Magique", "d3-magicsquare"],
  ["Ecriture Calculette BEGHILOS", "d3-calcspell"],
  ["Ecriture Calculette TI-30", "d3-calcspell"],
  ["Le Compte Est Bon", "d3-countdown"],
  ["Solveur 24", "d3-countdown"],
  ["Solveur All Ten", "d3-countdown"],
  ["Solveur Hexadoku (Sudoku 16x16)", "d3-sudoku-n"],
  ["Solveur Krypto", "d3-countdown"],
  ["Solveur Mathador", "d3-countdown"],
  ["Solveur Sudoku 8x8", "d3-sudoku-n"],
  ["Solveur Sudoku 10x10", "d3-sudoku-n"],
  ["Solveur Wordoku", "d3-sudoku-n"],
  ["Solveur de Calculs à Trous", "d3-holecalc"],
  ["Solveur de Calculs à Trous (Nombres)", "d3-holecalc"],
  ["Solveur de Calculs à Trous (Opérateurs)", "d3-holecalc"],
  ["Mot Précédent", "d3-wordorder"],
  ["Mot Suivant", "d3-wordorder"],
  ["Recherche de Mot", "d3-wordregex"],
  ["Recherche de Mot par Motif", "d3-wordregex"],
  ["Recherche de Mot par Regex", "d3-wordregex"],
  ["Générateur de Fausse Identité", "d3-fakeid"],
  ["Générateur de Pseudo", "d3-fakeid"],
  ["Variations de Mot de Passe", "d3-passvariants"],
  ["Caractères Spéciaux", "d3-chartype"],
  ["Extracteur de Chaines", "d3-strings"],
  ["Score de Lisibilité", "d3-readability"],
  ["Type de Caractères", "d3-chartype"],
  ["Chiffres Aléatoires", "d3-random"],
  ["Date en Latin", "d3-latin-date"],
  ["Décimales de Pi 3.14159…", "d3-constants"],
  ["Décimales de Tau τ=6.2831853…", "d3-constants"],
  ["Décimales de e 2.71828...", "d3-constants"],
  ["Décimales du Nombre d'Or Phi 1.61803...", "d3-constants"],
  ["Générateur d'Homoglyphes/Homographes", "d3-homoglyph"],
  ["Générateur de Labyrinthe", "d3-maze"],
  ["Générateur de Mot-Valise", "d3-portmanteau"],
  ["Jeu de la Vie", "d3-life"],
  ["Jour de la Semaine d'une Date", "d3-date"],
  ["Nombres Aléatoires", "d3-random"],
  ["Probabilités d'Anniversaire", "d3-birthday"],
  ["Recherche dans les Décimales", "d3-constants"],
  ["Signe Astrologique", "d3-zodiac"],
  ["Signe Astrologique Chinois", "d3-zodiac"],
  ["Calcul avec des Dates", "d3-date"],
  ["Différence entre 2 Dates", "d3-date"],
  ["Dilatation du Temps", "d3-timedilation"],
  ["Format de Date", "d3-date"],
  ["Nième Jour de l'Année", "d3-date"],
  ["Siècle d'une Année", "d3-date"],
  ["Code Alternate Mark Inversion", "d3-ami"],
  ["Notes Midi", "d3-midi"],
]);

const MAPPED = new Map([
  ["Solveur Bulls and Cows", "game-bullscows"],
  ["Solveur Wordox", "lex-scrabble"],
  ["Solveur de Popotamo", "lex-scrabble"],
  ["Solveur de Scrabble", "lex-scrabble"],
  ["Solveur de Set", "game-set"],
  ["Solveur de Taquin", "game-taquin"],
  ["Solveur de Taquin 3x3", "game-taquin"],
  ["Solveur de Taquin 4x4", "game-taquin"],
  ["Solveur de Taquin 5x5", "game-taquin"],
  ["Solveur de Tour de Hanoï", "game-hanoi"],
  ["Solveur Aworded", "lex-scrabble"],
  ["Solveur Lights Out", "game-lightsout"],
  ["Solveur Pixwords", "d3-wordfind（仅字母架；图片线索库未提供）"],
  ["Solveur Quel Est le Mot", "d3-wordfind（仅字母架；图片线索库未提供）"],
  ["Solveur de Wordfeud", "lex-scrabble"],
  ["Addition de Mots", "lex-anagram + game-cryptarithm + math-wordvalue（dCode 入口页）"],
  ["Echelle de Mots", "lex-ladder"],
  ["Lettres Mélangées", "txt-mixletters"],
  ["Mélangeur de Mots", "txt-mixwords"],
  ["Solveur 4 Images 1 Mot", "d3-wordfind（仅字母架；图片线索库未提供）"],
  ["Solveur Le Mot le Plus Long", "lex-longest"],
  ["Solveur Wordalot", "d3-wordfind（仅字母架；图片线索库未提供）"],
  ["Solveur de Mots entre Amis", "lex-scrabble"],
  ["Solveur de Pendu", "lex-pendu"],
  ["Solveur de Wordle", "lex-wordle"],
  ["Carré Latin", "game-latin"],
  ["Nombre de Lychrel", "math-lychrel"],
  ["Racine Numérique", "math-digitsum"],
  ["Solveur Binairo", "game-takuzu"],
  ["Solveur Binoxxo", "game-takuzu"],
  ["Solveur Cryptarithme", "game-cryptarithm"],
  ["Solveur Sudoku", "game-sudoku"],
  ["Solveur Sudoku 4x4", "game-sudoku"],
  ["Solveur Sudoku 6x6", "game-sudoku"],
  ["Solveur Sudozen (Sudoku 12x12)", "game-sudoku"],
  ["Solveur Takuzu", "game-takuzu"],
  ["Solveur de Kakuro", "game-kakuro（仅组合枚举；整盘求解未实现）"],
  ["Somme de Chiffres", "math-digitsum"],
  ["Valeur d'un Mot", "math-wordvalue"],
  ["Heterogramme", "lex-isogram"],
  ["Isogramme", "lex-isogram"],
  ["Mots Commençant par…", "lex-search"],
  ["Mots Contenant …", "lex-search"],
  ["Mots Finissant par…", "lex-search"],
  ["Adresse IP", "ipv4Int / ipv6Format（主程序）"],
  ["Chiffre ROT-47", "rot47（主程序）"],
  ["Codage Unicode", "unicodeEscape（主程序）"],
  ["Code Base64", "base64（主程序）"],
  ["Couleurs HTML", "color / colorInfo（主程序）"],
  ["Décodage d'URL", "url（主程序）"],
  ["Ecriture 1337 Leet Speak", "leetSpeak（主程序）"],
  ["HTML Escape", "htmlEntity（主程序）"],
  ["Code Baudot", "baudot（主程序）"],
  ["Code DTMF (FV)", "dtmf（主程序）"],
  ["Code Decabit", "decabit（主程序）"],
  ["Code Manchester", "manchester（主程序）"],
  ["Code Morse", "morse（主程序）"],
  ["Code T9 (SMS)", "t9Phone（主程序）"],
  ["Code Téléphone Multi-tap (SMS)", "multitap（主程序）"],
  ["Code Wabun", "wabun（主程序）"],
  ["Code de Clavier de Téléphone", "t9Phone（主程序）"],
  ["Accents et Diacritiques", "txt-accents"],
  ["Longueur de Texte", "txt-count"],
  ["Typoglycémie", "txt-typoglycemia"],
  ["Code Bibi-binaire", "num-bibi"],
  ["Conjecture de Syracuse", "math-sydney"],
  ["Dominos en Chiffres", "num-domino"],
  ["Ecriture Spéculaire (en Miroir)", "mirrorLetters（主程序）"],
  ["Ecriture en Sens Inverse > esrevnI", "txt-reverse"],
  ["Ecriture à l'Envers > sɹǝʌuƎ", "txt-updown"],
  ["Majuscule et Minuscule", "txt-case"],
  ["Numération Shadoks", "num-shadok"],
  ["Numérologie Chaldéenne", "math-wordvalue"],
  ["Numérologie Gematria", "math-wordvalue"],
  ["Numérologie Isopséphie", "math-wordvalue"],
  ["Numérologie de Pythagore", "math-wordvalue"],
  ["Suite de Conway", "math-lookandsay"],
  ["Tirage au Sort", "txt-draw"],
  ["Timestamp", "unixTime（主程序）"],
  ["Timestamp Windows", "filetime（主程序）"],
  ["Notes de Musique", "d3-midi（英语/法语 + MIDI/频率；印度 svara、德国 H、日本 Iroha、中国工尺、阿拉伯记谱转换未覆盖）"],
]);

const BLOCKED = new Map([
  ["Solveur Fling", "专有弹球谜题，规则/盘面格式未公开，未实现"],
  ["Solveur AlphaBetty", "专有六边形词盘与内置词典规则未公开"],
  ["Solveur de Codycross", "填字线索数据库不公开"],
  ["Alphamo", "专有词盘机制未公开"],
  ["Générateur d'Autogramme", "自描述句需受约束自然语言搜索，无公开确定性算法"],
  ["Harry - Le Jeu", "专有游戏规则/棋盘未公开"],
  ["Solveur Figguess", "图片线索语义库缺失"],
  ["Solveur de Mots-Croisés", "填字线索数据库不公开"],
  ["Solveur de Mots Couplés", "专有配对词游戏规则未公开"],
  ["Solveur Fill-A-Pix", "马赛克线索求解需完整盘面格式，未实现"],
  ["Solveur Picture Sweep", "专有图片扫雷玩法，规则/盘面格式未公开"],
  ["Solveur Sudoku 5x5", "无标准 5×5 宫格划分，dCode 变体规则未文档化"],
  ["Solveur Sudoku 7x7", "无标准 7×7 宫格划分"],
  ["Solveur Sudoku NxN Irrégulier", "不规则宫需区域映射输入，格式未文档化"],
  ["Solveur Tectonic", "区域逻辑谜题求解器未实现"],
  ["Clé de Transposition", "换位密钥恢复需完整密码分析器，未实现"],
  ["Enregistrements DNS", "需 DNS 网络查询，违反纯前端零外发"],
  ["Géolocalisation d'un Numéro de Téléphone", "需运营商/号码段数据库或外部 API"],
  ["Accent Allemand", "dCode 专有谐音改写规则未公开，规则近似会伪造结果"],
  ["Accent Anglais", "dCode 专有谐音改写规则未公开，规则近似会伪造结果"],
  ["Accent Asiatique", "dCode 专有谐音改写规则未公开，规则近似会伪造结果"],
  ["Accent Espagnol", "dCode 专有谐音改写规则未公开，规则近似会伪造结果"],
  ["Accent Etranger", "dCode 专有谐音改写规则未公开，规则近似会伪造结果"],
  ["Accent Français", "dCode 专有谐音改写规则未公开，规则近似会伪造结果"],
  ["Accent Italien", "dCode 专有谐音改写规则未公开，规则近似会伪造结果"],
  ["Accent Russe", "dCode 专有谐音改写规则未公开，规则近似会伪造结果"],
  ["Caractères des Alphabets Etrangers", "外语字母参考/输入表，非确定性算法"],
  ["Carte d'Identité Européenne", "身份证件/MRZ 版式与校验规则依发行国而异，缺数据"],
  ["Carte d'Identité Française", "法国身份证号码/版式校验规则未内置"],
  ["Chiffres Miroir", "镜像数字为图形符号，无标准 Unicode 映射"],
  ["Ecriture Dotsies", "Dotsies 点阵字体映射非 Unicode 标准，未内置"],
  ["Langage de Shankar (Slumdog Millionnaire)", "虚构语言映射未公开"],
  ["Rotation du Cube", "三维魔方状态旋转，输入格式/规则未文档化"],
  ["Séparateur de Syllabes", "音节切分需语言词典/专门算法，规则近似不可靠"],
  ["Chiffre par Partition Musicale", "乐谱图形/音符映射未文档化"],
  ["Code Acéré", "冷门符号密码，无公开规范"],
  ["Notation des Accords de Guitare", "和弦指法图数据库缺失"],
  ["Partition/Portée de Musique", "五线谱渲染需图形/字体引擎"],
]);

export const COVERAGE = CATALOG.flatMap(([cat, text]) =>
  text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
    const [name, slug] = line.split("|");
    const url = `https://www.dcode.fr/${slug}`;
    if (IMPLEMENTED.has(name)) return { cat, name, slug, url, status: "implemented", op: IMPLEMENTED.get(name) };
    if (MAPPED.has(name)) return { cat, name, slug, url, status: "mapped", op: MAPPED.get(name) };
    if (BLOCKED.has(name)) return { cat, name, slug, url, status: "blocked", reason: BLOCKED.get(name) };
    return { cat, name, slug, url, status: "blocked", reason: "台账缺失（内部错误，请报告）" };
  })
);
