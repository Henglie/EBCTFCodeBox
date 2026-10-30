/*
 * dcode-extras · 内置词典批（对标 dCode Jeux de Lettres / Recherche de Mots 词典向工具）
 * 词典：../data/lexicon-{en,fr}.txt 纯文本（EN 56k / FR 93k；SCOWL MIT 类 + Letterpress CC0，来源与哈希见文件头），插件 activate 时一次载入
 * 词表随插件包分发；所有检索有界（结果上限、输入长度上限），超限如实标注截断。
 */

import { runOp } from "../lib/util.js";

const CAT = "dcode-extras-2026-10/cat-game";
const P = (key, label, ph) => ({ key, label, type: "text", default: "", placeholder: ph || "" });
const SEL = (key, label, def, opts) => ({ key, label, type: "select", default: def, options: opts.map((o) => (typeof o === "string" ? { value: o, label: o } : o)) });

// ---- 词典（纯文本随包，插件 activate 时一次载入；不内嵌 JS） ----
const _cache = new Map();
let _loading = null;

async function readData(name) {
  const url = new URL(`../data/${name}`, import.meta.url);
  if (typeof process !== "undefined" && typeof process.getBuiltinModule === "function") {
    return process.getBuiltinModule("node:fs").readFileSync(url, "utf8");
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`词典加载失败（${name}）：HTTP ${res.status}`);
  return res.text();
}

export function loadLexicon() {
  if (_loading) return _loading;
  _loading = Promise.all(["en", "fr"].map(async (lang) => {
    const text = await readData(`lexicon-${lang}.txt`);
    _cache.set(lang, text.split("\n").map((w) => w.trim()).filter((w) => w && !w.startsWith("#")));
  })).then(() => true);
  return _loading;
}

function words(lang) {
  const key = lang === "fr" ? "fr" : "en";
  if (!_cache.has(key)) throw new Error("词典尚未加载（插件 activate 时应先 await loadLexicon）");
  return _cache.get(key);
}

// ---- Scrabble 分值表（来源：北美 TWL 与法国 ODS/FFL 官方分值，写死并注明） ----
const SCORE_EN = (() => { const t = {}; for (const c of "aeilmnorstu") t[c] = 1; for (const c of "dg") t[c] = 2; for (const c of "bcmp") t[c] = 3; for (const c of "fhvwy") t[c] = 4; t.k = 5; for (const c of "jx") t[c] = 8; for (const c of "qz") t[c] = 10; return t; })();
const SCORE_FR = (() => { const t = {}; for (const c of "aeilnorstu") t[c] = 1; for (const c of "dgm") t[c] = 2; for (const c of "bcp") t[c] = 3; for (const c of "fhv") t[c] = 4; for (const c of "jq") t[c] = 8; for (const c of "kwxyz") t[c] = 10; return t; })();

const wordScore = (w, lang) => [...w].reduce((a, c) => a + ((lang === "fr" ? SCORE_FR : SCORE_EN)[c] ?? 0), 0);

const letterBag = (s) => { const m = new Map(); for (const c of s.toLowerCase()) m.set(c, (m.get(c) || 0) + 1); return m; };
const canBuild = (w, bag) => {
  const need = letterBag(w);
  for (const [c, n] of need) if ((bag.get(c) || 0) < n) return false;
  return true;
};

const MAX_OUT = 300;

export const OPS = [
  runOp("dcode-extras-2026-10/lex-scrabble", CAT, "Scrabble 求解（字母架+分值）", "给字母架（? 为通配任意字母）列可拼词与分值，按分排降序；分值表=北美 TWL / 法国 ODS（官方每字母分值，来源注明于 desc 与来源档案）",
    (t, p) => {
      const lang = String((p && p.lang) || "en");
      const rack = String((p && p.rack) || t || "").toLowerCase().replace(/[^a-z?]/g, "");
      if (rack.length < 2 || rack.length > 12) throw new Error("字母架需 2..12 个字母（? 通配）");
      const wilds = [...rack].filter((c) => c === "?").length;
      if (wilds > 2) throw new Error("通配最多 2 个（防爆炸）");
      const bag = letterBag(rack.replace(/\?/g, ""));
      const hits = [];
      for (const w of words(lang)) {
        if (w.length < 2 || w.length > rack.length) continue;
        const need = letterBag(w);
        let short = 0;
        for (const [c, n] of need) { const d = (bag.get(c) || 0) - n; if (d < 0) short += -d; }
        if (short > wilds) continue;
        hits.push([w, wordScore(w, lang)]);
        if (hits.length > 200000) throw new Error("命中过多，请减少通配");
      }
      hits.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
      const top = hits.slice(0, MAX_OUT);
      return `字母架「${rack}」（${lang === "fr" ? "法语 ODS" : "英语 TWL"} 分值）：命中 ${hits.length} 词${hits.length > MAX_OUT ? `，列前 ${MAX_OUT}` : ""}\n` +
        top.map(([w, s]) => `${s}\t${w}`).join("\n");
    }, [P("rack", "字母架（? 通配≤2）", "quiz"), SEL("lang", "语言", "en", [{ value: "en", label: "英语 TWL" }, { value: "fr", label: "法语 ODS" }])]),

  runOp("dcode-extras-2026-10/lex-ladder", CAT, "词梯（Word Ladder / Échelle de Mots）", "BFS 最短词梯：同长度、每步换一个字母（如 cat→cot→cog→dog）；内置词典；无路径如实报告",
    (t, p) => {
      const src = String((p && p.pair) || t || "").trim().toLowerCase();
      const m = src.match(/^([a-z]+)\s*[,>→-]+\s*([a-z]+)$/);
      if (!m) throw new Error("格式：起,终（如 cat,dog）");
      const [a, b] = [m[1], m[2]];
      if (a.length !== b.length) throw new Error("起止词需同长度");
      if (a.length < 2 || a.length > 8) throw new Error("词长 2..8（防爆炸）");
      const lang = String((p && p.lang) || "en");
      const dict = new Set(words(lang).filter((w) => w.length === a.length && /^[a-z]+$/.test(w)));
      if (!dict.has(a)) return `起始词「${a}」不在内置词典中（换词或换语言档）`;
      if (!dict.has(b)) return `目标词「${b}」不在内置词典中`;
      const prev = new Map([[a, null]]);
      let frontier = [a];
      const az = "abcdefghijklmnopqrstuvwxyz";
      while (frontier.length && !prev.has(b)) {
        const next = [];
        for (const cur of frontier) {
          for (let i = 0; i < cur.length; i++) {
            for (const c of az) {
              if (c === cur[i]) continue;
              const cand = cur.slice(0, i) + c + cur.slice(i + 1);
              if (dict.has(cand) && !prev.has(cand)) { prev.set(cand, cur); next.push(cand); }
            }
          }
        }
        frontier = next;
        if (prev.size > 200000) throw new Error("搜索超 20 万词，中止");
      }
      if (!prev.has(b)) return `${a} → ${b}：内置词典中无词梯路径（每词只换一个字母）`;
      const path = [];
      for (let cur = b; cur !== null; cur = prev.get(cur)) path.unshift(cur);
      return `${a} → ${b}：${path.length - 1} 步\n${path.join(" → ")}`;
    }, [P("pair", "起,终", "cat,dog"), SEL("lang", "语言", "en", [{ value: "en", label: "英语" }, { value: "fr", label: "法语" }])]),

  runOp("dcode-extras-2026-10/lex-longest", CAT, "最长词（Le Mot le Plus Long）", "给定字母集（每字母至多用一次），找可拼出的最长词；列前若干同长词",
    (t, p) => {
      const lang = String((p && p.lang) || "fr");
      const letters = String((p && p.letters) || t || "").toLowerCase().replace(/[^a-zà-ÿ]/g, "");
      if (letters.length < 3 || letters.length > 15) throw new Error("字母集需 3..15 个字母");
      const bag = letterBag(letters);
      let best = [], bestLen = 0;
      for (const w of words(lang)) {
        if (w.length < bestLen || w.length < 3) continue;
        if (canBuild(w, bag)) {
          if (w.length > bestLen) { bestLen = w.length; best = [w]; }
          else if (w.length === bestLen && best.length < 30) best.push(w);
        }
      }
      if (!bestLen) return `字母集「${letters}」拼不出 ≥3 字母的词`;
      return `字母集「${letters}」最长 ${bestLen} 字母：\n` + best.join(", ");
    }, [P("letters", "字母集", "aeiourst"), SEL("lang", "语言", "fr", [{ value: "en", label: "英语" }, { value: "fr", label: "法语" }])]),

  runOp("dcode-extras-2026-10/lex-search", CAT, "词检索（前缀/后缀/包含）", "内置词典按前缀/后缀/包含检索（模式：^abc / abc$ / abc）",
    (t, p) => {
      const lang = String((p && p.lang) || "en");
      const mode = String((p && p.mode) || "prefix");
      const q = String((p && p.q) || t || "").trim().toLowerCase();
      if (!q || q.length > 20) throw new Error("需要 ≤20 字符的检索串");
      const all = words(lang);
      const hits = [];
      for (const w of all) {
        const ok = mode === "prefix" ? w.startsWith(q) : mode === "suffix" ? w.endsWith(q) : w.includes(q);
        if (ok) { hits.push(w); if (hits.length >= MAX_OUT) break; }
      }
      const exact = `（共截断到 ${MAX_OUT} 条${hits.length >= MAX_OUT ? "，可能不全" : ""}）`;
      return hits.length ? `模式 ${mode}「${q}」命中 ${hits.length} 条${exact}\n${hits.join("\n")}` : `模式 ${mode}「${q}」无命中`;
    }, [P("q", "检索串", "conson"), SEL("mode", "模式", "prefix", [{ value: "prefix", label: "前缀" }, { value: "suffix", label: "后缀" }, { value: "contain", label: "包含" }]), SEL("lang", "语言", "en", [{ value: "en", label: "英语" }, { value: "fr", label: "法语" }])]),

  runOp("dcode-extras-2026-10/lex-pendu", CAT, "刽子手候选（Pendu）", "给定长度与已知位（. 未知，如 q..z.）枚举词典候选；法语支持重音未知位",
    (t, p) => {
      const lang = String((p && p.lang) || "en");
      const pat = String((p && p.pat) || t || "").toLowerCase().trim();
      if (!/^[a-zà-ÿ.]{2,12}$/.test(pat)) throw new Error("模式为 2..12 位，字母或 . （如 q..z.）");
      const re = new RegExp("^" + pat.replace(/\./g, "[a-zà-ÿ]") + "$");
      const hits = words(lang).filter((w) => re.test(w));
      if (hits.length > MAX_OUT) return `命中 ${hits.length} 条（过多，仅列前 ${MAX_OUT}）：\n${hits.slice(0, MAX_OUT).join("\n")}`;
      return hits.length ? `模式「${pat}」命中 ${hits.length} 条：\n${hits.join("\n")}` : `模式「${pat}」无候选`;
    }, [P("pat", "模式", "q..z"), SEL("lang", "语言", "en", [{ value: "en", label: "英语" }, { value: "fr", label: "法语" }])]),

  runOp("dcode-extras-2026-10/lex-isogram", CAT, "异形词列举（Isogram/Heterogram）", "给定长度（2..15），列举全部无重复字母的词（isogram）",
    (t, p) => {
      const lang = String((p && p.lang) || "en");
      const n = Number((p && p.len) || t) || 0;
      if (!Number.isInteger(n) || n < 2 || n > 15) throw new Error("长度需 2..15");
      const hits = [];
      for (const w of words(lang)) {
        if (w.length !== n) continue;
        if (new Set(w).size === n) { hits.push(w); if (hits.length >= MAX_OUT) break; }
      }
      return hits.length ? `${n} 字母 isogram（截断 ${MAX_OUT}）：\n${hits.join("\n")}` : `词典中无 ${n} 字母 isogram（长度 15+ 极罕见）`;
    }, [P("len", "长度", "7"), SEL("lang", "语言", "en", [{ value: "en", label: "英语" }, { value: "fr", label: "法语" }])]),

  runOp("dcode-extras-2026-10/lex-anagram", CAT, "整词变位词求解（Anagrammes）", "给乱序字母串，在词典中找全部变位词（同字母多重集）",
    (t, p) => {
      const lang = String((p && p.lang) || "en");
      const q = String((p && p.q) || t || "").toLowerCase().replace(/[^a-zà-ÿ]/g, "");
      if (q.length < 2 || q.length > 12) throw new Error("字母串需 2..12 位");
      const key = (w) => [...w].sort().join("");
      const k = key(q);
      const hits = words(lang).filter((w) => w.length === q.length && key(w) === k);
      return hits.length ? `「${q}」的变位词 ${hits.length} 个：\n${hits.join("\n")}` : `「${q}」在词典中无变位词`;
    }, [P("q", "字母串", "listen"), SEL("lang", "语言", "en", [{ value: "en", label: "英语" }, { value: "fr", label: "法语" }])]),

  runOp("dcode-extras-2026-10/lex-wordle", CAT, "Wordle 过滤（内置词典）", "按历史反馈行（词:G黄绿灰，如 stare:GY...）在内置词典中过滤候选；G=位对 Y=字母在位错 .=不在（严格含次数约束）",
    (t, p) => {
      const lang = String((p && p.lang) || "en");
      const lines = String(t || "").trim().split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      if (!lines.length) throw new Error("每行一条「stare:GY...」");
      const hist = lines.map((l) => {
        const m = l.replace(/\s/g, "").match(/^([a-zà-ÿ]+):([GY.]+)$/i);
        if (!m) throw new Error(`行「${l}」格式应为 stare:GY...`);
        if (m[1].length !== m[2].length) throw new Error(`「${l}」词与反馈长度不一致`);
        return { g: m[1].toLowerCase(), f: m[2].toUpperCase() };
      });
      const L = hist[0].g.length;
      const filter = (w) => {
        if (w.length !== L) return false;
        for (const { g, f } of hist) {
          const rest = [...w];
          for (let i = 0; i < L; i++) if (f[i] === "G") { if (w[i] !== g[i]) return false; rest[i] = null; }
          for (let i = 0; i < L; i++) {
            if (f[i] === "Y") { const k = rest.indexOf(g[i]); if (k < 0) return false; rest[k] = null; }
            else if (f[i] === "." && w[i] === g[i]) return false;
          }
          for (let i = 0; i < L; i++) {
            if (f[i] === ".") {
              const cntG = [...f].filter((x, j) => x === "G" && g[j] === g[i]).length;
              const cntY = [...f].filter((x, j) => x === "Y" && g[j] === g[i]).length;
              if ([...w].filter((c) => c === g[i]).length > cntG + cntY) return false;
            }
          }
        }
        return true;
      };
      const hits = words(lang).filter(filter);
      if (hits.length > MAX_OUT) return `剩余候选 ${hits.length} 个（过多，列前 ${MAX_OUT}）：\n${hits.slice(0, MAX_OUT).join("\n")}`;
      return hits.length ? `剩余候选 ${hits.length} 个：\n${hits.join("\n")}` : "无候选（反馈矛盾或词典缺失）";
    }, [SEL("lang", "语言", "en", [{ value: "en", label: "英语" }, { value: "fr", label: "法语" }])]),
];
