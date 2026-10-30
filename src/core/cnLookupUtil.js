/*
 * cnLookupUtil.js — 中文查字编码共用运行时（五笔/郑码/电码/四角/仓颉）。
 *
 * 码表在 public/data/cn/*.tsv（普通文本，不进 JS bundle），由 tools/gen_cn_lookup_data.mjs
 * 生成；本文件只做按需加载、解析、分词、候选渲染，不含任何具体码表。
 * 同码多字按码表行序（生成时已按词频排好）。
 */

const CJK_RE = /^[\u3400-\u4dbf\u4e00-\u9fff]$/;
const isCjk = (ch) => CJK_RE.test(ch);

function addCode(table, ch, code) {
  if (!code) return;
  let codes = table.charToCodes.get(ch);
  if (!codes) table.charToCodes.set(ch, (codes = []));
  if (!codes.includes(code)) codes.push(code);
  let chars = table.codeToChars.get(code);
  if (!chars) table.codeToChars.set(code, (chars = []));
  if (!chars.includes(ch)) chars.push(ch);
  if (code.length > table.maxCodeLen) table.maxCodeLen = code.length;
}

const CN_TABLE_FILES = {
  wubi: "wubi.tsv",
  telegraph: "telegraph.tsv",
  zhengma: "zhengma.tsv",
  fourcorner: "fourcorner.tsv",
  cangjie: "cangjie.tsv",
};
const CN_TABLES = new Map();

/**
 * 按需加载并解析码表。Node（测试/CLI）同步读盘并返回表；浏览器/Worker 返回 Promise。
 * 路径相对本模块解析（../../public/data/cn/），根路径与 Pages 子路径部署都成立。
 */
export function loadCnTable(kind) {
  if (CN_TABLES.has(kind)) return CN_TABLES.get(kind);
  const file = CN_TABLE_FILES[kind];
  if (!file) throw new Error(`未知码表：${kind}`);
  const url = new URL(`../../public/data/cn/${file}`, import.meta.url);
  const parse = (raw) => {
    const table = kind === "wubi" ? parseWubiTable(raw)
      : kind === "fourcorner" ? parseFourCornerTable(raw)
        : parseSimpleTable(raw);
    CN_TABLES.set(kind, table);
    return table;
  };
  if (typeof process !== "undefined" && typeof process.getBuiltinModule === "function") {
    return parse(process.getBuiltinModule("node:fs").readFileSync(url, "utf8"));
  }
  return fetch(url).then((res) => {
    if (!res.ok) throw new Error(`码表加载失败（${kind}）：HTTP ${res.status}`);
    return res.text().then(parse);
  });
}

/** 表就绪后执行 fn：Node 同步直返，浏览器/Worker 返回 Promise。 */
export function withCnTable(kind, fn) {
  const table = loadCnTable(kind);
  return table && typeof table.then === "function" ? table.then(fn) : fn(table);
}

/** 通用「字符<TAB>码1|码2」表。 */
export function parseSimpleTable(raw) {
  const table = { charToCodes: new Map(), codeToChars: new Map(), charRank: new Map(), maxCodeLen: 0 };
  let rank = 0;
  for (const line of String(raw || "").split("\n")) {
    const tab = line.indexOf("\t");
    if (tab <= 0) continue;
    const ch = line.slice(0, tab);
    const codes = line.slice(tab + 1).split("|").filter(Boolean);
    if (!codes.length) continue;
    table.charRank.set(ch, rank++);
    for (const code of codes) addCode(table, ch, code);
  }
  return table;
}

/** 四角号码额外建 4 位前缀索引（解码允许省略第 5 位附号）。 */
export function parseFourCornerTable(raw) {
  const table = parseSimpleTable(raw);
  const code4ToChars = new Map();
  const push = (key, ch) => {
    let arr = code4ToChars.get(key);
    if (!arr) code4ToChars.set(key, (arr = []));
    if (!arr.includes(ch)) arr.push(ch);
  };
  // 5 位码取前 4 位；4 位码本身也进索引。
  for (const [code, chars] of table.codeToChars) {
    if (code.length === 5) for (const ch of chars) push(code.slice(0, 4), ch);
    else if (code.length === 4) for (const ch of chars) push(code, ch);
  }
  const rank = (ch) => table.charRank.get(ch) ?? 1e9;
  for (const arr of code4ToChars.values()) arr.sort((a, b) => rank(a) - rank(b) || a.codePointAt(0) - b.codePointAt(0));
  table.code4ToChars = code4ToChars;
  return table;
}

/** 五笔：字符<TAB>86码<TAB>98码。 */
export function parseWubiTable(raw) {
  const make = () => ({ charToCodes: new Map(), codeToChars: new Map(), charRank: new Map(), maxCodeLen: 0 });
  const t86 = make(), t98 = make();
  let rank = 0;
  for (const line of String(raw || "").split("\n")) {
    const parts = line.split("\t");
    if (parts.length < 3) continue;
    const [ch, c86, c98] = parts;
    if (!c86 && !c98) continue;
    t86.charRank.set(ch, rank);
    t98.charRank.set(ch, rank);
    rank++;
    if (c86) addCode(t86, ch, c86);
    if (c98) addCode(t98, ch, c98);
  }
  return { 86: t86, 98: t98 };
}

/** 编码：已知字→首码；未收录汉字原样保留；非汉字连续段原样作为一段。 */
export function encodeWithTable(text, table, opts = {}) {
  const sep = opts.sep ?? " ";
  const format = opts.format || ((code) => code);
  const tokens = [];
  let run = "";
  const flush = () => { if (run) { tokens.push(run); run = ""; } };
  for (const ch of String(text ?? "")) {
    const codes = table.charToCodes.get(ch);
    if (codes && codes.length) {
      flush();
      tokens.push(format(codes[0]));
    } else if (isCjk(ch)) {
      flush();
      tokens.push(ch);
    } else {
      run += ch;
    }
  }
  flush();
  return tokens.join(sep).replace(/[ \t]{2,}/g, " ").trim();
}

/** 字母码连写时的最长匹配分段（带回溯；整串本身是合法码时不分段）。 */
function segmentLetters(token, table, caseMode) {
  if (!/^[A-Za-z]+$/.test(token)) return [token];
  const s = caseMode === "lower" ? token.toLowerCase() : token.toUpperCase();
  if (table.codeToChars.has(s)) return [s];
  const max = Math.min(table.maxCodeLen, s.length);
  if (max < 1 || s.length > 64) return [token];
  const memo = new Array(s.length + 1);
  const solve = (i) => {
    if (i === s.length) return [];
    if (memo[i] !== undefined) return memo[i];
    for (let len = Math.min(max, s.length - i); len >= 1; len--) {
      const code = s.slice(i, i + len);
      if (!table.codeToChars.has(code)) continue;
      const rest = solve(i + len);
      if (rest) return (memo[i] = [code, ...rest]);
    }
    return (memo[i] = null);
  };
  return solve(0) || [token];
}

function splitDigits(token, sizes) {
  const s = token.replace(/\D/g, "");
  if (!s || s.length <= sizes[0]) return [token];
  for (const size of sizes) {
    if (s.length % size === 0) {
      const out = [];
      for (let i = 0; i < s.length; i += size) out.push(s.slice(i, i + size));
      return out;
    }
  }
  return [token];
}

function decodePieces(text, table, opts = {}) {
  const rawTokens = String(text ?? "").split(/[\s,;，；、]+/).filter(Boolean);
  const tokens = [];
  for (const token of rawTokens) {
    if (opts.segment) tokens.push(...opts.segment(token));
    else tokens.push(token);
  }
  const pieces = [];
  for (const token of tokens) {
    const normalized = opts.normalize ? opts.normalize(token) : token;
    const cands = normalized ? (opts.lookup ? opts.lookup(normalized) : table.codeToChars.get(normalized)) : null;
    if (cands && cands.length) {
      pieces.push({ kind: "code", text: renderCandidates(cands, opts) });
    } else if (isCjk(token) || !(opts.isCodeLike ? opts.isCodeLike(token) : /^[A-Za-z0-9.]+$/.test(token))) {
      pieces.push({ kind: "literal", text: token });
    } else {
      pieces.push({ kind: "literal", text: "?" });
    }
  }
  let out = "";
  for (const p of pieces) {
    if (p.kind === "literal") {
      if (out && !/\s$/.test(out)) out += " ";
      out += p.text;
      if (!/\s$/.test(out)) out += " ";
    } else if (p.text.startsWith("[")) {
      // 候选组之间留空格，避免 [其|共][有|内] 挤成一片；唯一候选仍直接拼接成句。
      if (out && !/\s$/.test(out)) out += " ";
      out += p.text + " ";
    } else {
      out += p.text;
    }
  }
  return out.replace(/[ \t]{2,}/g, " ").trim();
}

export function renderCandidates(cands, opts = {}) {
  if (opts.all) return cands.length === 1 ? cands[0] : "[" + cands.join("|") + "]";
  const n = Number(opts.pick);
  const idx = Number.isFinite(n) ? Math.max(0, Math.min(cands.length - 1, Math.trunc(n) - 1)) : 0;
  return cands[idx];
}

/** 字母码解码（五笔/郑码/仓颉）。 */
export function decodeLetters(text, table, opts = {}) {
  const caseMode = opts.caseMode || "lower";
  const normalize = (token) => {
    if (!/^[A-Za-z]+$/.test(token)) return "";
    const s = caseMode === "lower" ? token.toLowerCase() : token.toUpperCase();
    return table.codeToChars.has(s) ? s : "";
  };
  const isCodeLike = (token) => /^[A-Za-z]+$/.test(token);
  const segment = (token) => segmentLetters(token, table, caseMode);
  return decodePieces(text, table, { ...opts, normalize, isCodeLike, segment });
}

/** 纯数字码解码（中文电码/四角号码）。lookup 由调用方提供。 */
export function decodeDigits(text, opts = {}) {
  return decodePieces(text, opts.table || { codeToChars: new Map() }, {
    ...opts,
    isCodeLike: (token) => /^[0-9.]+$/.test(token),
  });
}

/** 统一的分词/归一化小工具，供五个 op 复用。 */
export const CN_LOOKUP = {
  isCjk,
  tokenize: (text) => String(text ?? "").trim().split(/[\s,;，；、]+/).filter(Boolean),
  splitDigits,
  segmentLetters,
  // Wubi 码不用 z（z 是输入法通配键），用于降误报。
  wubiTokens: (text) => String(text ?? "").trim().split(/[\s,;，；、]+/).filter(Boolean),
};

// 常见英文短词（防止把 "the cat" 之类误判成五笔/郑码）。
const COMMON_EN = new Set([
  "the", "and", "for", "are", "but", "not", "you", "all", "any", "can", "had", "her", "was", "one",
  "our", "out", "day", "get", "has", "him", "his", "how", "man", "new", "now", "old", "see", "two",
  "way", "who", "boy", "did", "its", "let", "put", "say", "she", "too", "use", "cat", "dog", "hello",
  "world", "flag", "ctf", "test", "code", "this", "that", "with", "from", "have", "will", "your",
]);

export function detectWubi(text) {
  const toks = CN_LOOKUP.tokenize(text);
  if (toks.length < 2) return 0;
  if (!toks.every((t) => /^[a-y]{1,4}$/i.test(t))) return 0;
  const lower = toks.filter((t) => /^[a-z]+$/.test(t)).length;
  if (!lower) return 0;
  if (toks.every((t) => COMMON_EN.has(t.toLowerCase()))) return 0;
  return lower === toks.length ? 0.3 : 0.15;
}

export function detectZhengma(text) {
  const toks = CN_LOOKUP.tokenize(text);
  if (toks.length < 2) return 0;
  if (!toks.every((t) => /^[A-Z]{1,4}$/.test(t))) return 0;
  return 0.25;
}

export function detectCangjie(text) {
  const toks = CN_LOOKUP.tokenize(text);
  if (toks.length < 2) return 0;
  if (!toks.every((t) => /^[A-Y]{1,5}$/.test(t))) return 0;
  return toks.some((t) => t.length === 5) ? 0.4 : 0.25;
}

export function detectTelegraph(text) {
  const toks = CN_LOOKUP.tokenize(text);
  if (toks.length < 2 || !toks.every((t) => /^\d{4}$/.test(t))) return 0;
  return toks.every((t) => +t >= 1 && +t <= 9699) ? 0.35 : 0.2;
}

export function detectFourCorner(text) {
  const toks = CN_LOOKUP.tokenize(text);
  if (!toks.length) return 0;
  if (toks.some((t) => /^\d{4}\.\d$/.test(t))) return 0.5;
  if (!toks.every((t) => /^\d{4,5}$/.test(t))) return 0;
  return toks.some((t) => t.length === 5) ? 0.45 : 0.2;
}
