/*
 * classicExt4.js — T508 批一·古典补充组（A1-A7，A8 圣殿骑士缓）。
 *
 * 7 个 op：homophonic / doubleTrans / pollux / morbit / bookCipher / turningGrille / kenny。
 * 口径来源（逐项）：
 *   homophonic     — 同音替换（Wikipedia: Homophonic substitution cipher）：一明文字母 → 多密文符号池，
 *                    解密按符号唯一反查；表由 key+池+分配方式派生（mulberry32），选择轮转/随机两档。
 *   doubleTrans    — 双重列移位（Wikipedia: Double transposition）：本项目「列移位」连用两次，
 *                    与既有 columnar op 完全同口径（只保留 A-Z，列长按行填充余数分布）。
 *   pollux         — dCode chiffre-pollux（2026-09 抓取核实）：摩斯点/划/分隔 → 符号池替换；
 *                    默认分区 dot=047 / dash=158 / sep=2369（10 数字恰好各归一类）；
 *                    词分隔策略 double（sep×2，可往返，默认）/ single（dCode 页面单符号读法）。
 *   morbit         — dCode chiffre-morbit（2026-09 抓取核实）：摩斯含分隔符写成符号流按两位一组，
 *                    9 种对标准序 ..(1) .-(2) ./(3) -.(4) --(5) -/(6) /.(7) /-(8) //(9)；
 *                    密钥 9 字符按稳定字母排序得秩（任意 9 字符密钥的秩必为 1-9 排列），
 *                    官方示例密钥 MORSECODE → 568931724，示例 MORE BITS → 32379749578158。
 *   bookCipher     — 书卷密码（Wikipedia: Book cipher）：编号指向共享文本中的词；
 *                    本实现 word（全序词位）/ line-word（行.词）两种编号制。
 *   turningGrille  — 转动格栅 Fleissner（Wikipedia: Grille (cryptography)）：N×N 格栅每次
 *                    旋转 90°，共 4 次逐格填入/读出；旋转轨道约束逐轨道恰 1 孔；
 *                    奇数 N 中心格禁用（自映射格）；默认格栅=每轨道取左上象限格（规范形）。
 *   kenny          — dCode code-kenny-southpark（2026-09 抓取核实）：M=0/P=1/F=2 三进制，
 *                    A=MMM … Z=FFP（值 0-25），FFF(26) 页面未分配——本实现作可选空格扩展档。
 *
 * 对拍与测试：资料/工程留存/T508/批1_古典A/test_batch1.mjs（dCode 双例 + 手推向量 + 往返 + 异常）。
 * 本文件为自研实现；摩斯表复用 fancy.js（MORSE_REV/morseDecode），列移位复用 classic.js（columnarEncode/Decode）。
 */
import { register } from "./registry.js";
import { morseDecode, MORSE_REV } from "./fancy.js";
import { columnarEncode, columnarDecode } from "./classic.js";

/* ---------- 公共：种子化 PRNG（mulberry32 + FNV-1a 字符串哈希） ---------- */
function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rngFrom = (str) => mulberry32(fnv1a(String(str || "")));

/* ================================================================
 * A1 同音替换 homophonic
 * ================================================================ */
// 英语字母频率（%，Wikipedia: Letter frequency）——freq 档按比例分配符号
const EN_FREQ = {
  E: 12.7, T: 9.1, A: 8.2, O: 7.5, I: 7.0, N: 6.7, S: 6.3, H: 6.1, R: 6.0, D: 4.3,
  L: 4.0, C: 2.8, U: 2.8, M: 2.4, W: 2.4, F: 2.2, G: 2.0, Y: 2.0, P: 1.9, B: 1.5,
  V: 1.0, K: 0.8, J: 0.15, X: 0.15, Q: 0.10, Z: 0.07,
};
const AZ = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/* 生成同音表：pool 为互异符号数组，返回 { 字母: [符号…] }，符号总数 = pool.length */
function buildHomophones(pool, distribute, rng) {
  if (new Set(pool).size !== pool.length)
    throw new Error("同音替换：符号池存在重复符号。");
  if (pool.length < 26)
    throw new Error(`同音替换：符号池只有 ${pool.length} 个符号，至少需要 26（每字母 1 个）。`);
  const shuffled = [...pool];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  let counts;
  if (distribute === "freq") {
    // 最大余数法按频率分配，每字母保底 1
    counts = {};
    const totalW = Object.values(EN_FREQ).reduce((a, b) => a + b, 0);
    let used = 0;
    for (const L of AZ) { counts[L] = Math.max(1, Math.floor((EN_FREQ[L] / totalW) * pool.length)); used += counts[L]; }
    // 余量按频率/已配 比从高到低补
    const order = [...AZ].sort((a, b) => EN_FREQ[b] / counts[b] - EN_FREQ[a] / counts[a]);
    for (const L of order) { if (used >= pool.length) break; counts[L]++; used++; }
    // 超配时从占比最低的字母回收（保底 1）
    let over = used - pool.length;
    const asc = [...AZ].sort((a, b) => EN_FREQ[a] / counts[a] - EN_FREQ[b] / counts[b]);
    for (const L of asc) { if (over <= 0) break; const take = Math.min(over, counts[L] - 1); counts[L] -= take; over -= take; }
  } else {
    // even：均分，前 pool.length%26 个字母多 1
    counts = {};
    const q = Math.floor(pool.length / 26), r = pool.length % 26;
    [...AZ].forEach((L, i) => { counts[L] = q + (i < r ? 1 : 0); });
  }
  const table = {};
  let p = 0;
  for (const L of AZ) { table[L] = shuffled.slice(p, p + counts[L]); p += counts[L]; }
  return table;
}

function homophonicPool(p) {
  const mode = (p && p.pool) || "digits2";
  if (mode === "digits2") return Array.from({ length: 100 }, (_, i) => String(i).padStart(2, "0"));
  const cs = String((p && p.customPool) || "");
  if (!cs) throw new Error("同音替换：自定义符号池为空（每字符一个同音符号，至少 26 个互异字符）。");
  return [...cs];
}

function homophonicEncode(text, p) {
  const pool = homophonicPool(p);
  if ((p && p.pool) !== "custom" && /\d/.test(String(text ?? "")))
    throw new Error("同音替换：00-99 数字池模式下明文含阿拉伯数字会与密文符号混淆、无法解回——请去数字或改用自定义字符池。");
  const distribute = (p && p.distribute) || "freq";
  const table = buildHomophones(pool, distribute, rngFrom(`${(p && p.key) || ""}|${(p && p.pool) || "digits2"}|${(p && p.customPool) || ""}`));
  const selection = (p && p.selection) || "roundrobin";
  const rng2 = rngFrom(`${(p && p.key) || ""}|sel|${(p && p.seed) || 1}`);
  const cursor = {};
  const out = [];
  for (const ch of String(text ?? "")) {
    const up = ch.toUpperCase();
    if (table[up]) {
      const set = table[up];
      let idx;
      if (selection === "random") idx = Math.floor(rng2() * set.length);
      else { idx = (cursor[up] = cursor[up] || 0) % set.length; cursor[up]++; }
      out.push(set[idx]);
    } else out.push(ch); // 非字母原样保留
  }
  return out.join("");
}

function homophonicDecode(text, p) {
  const pool = homophonicPool(p);
  const distribute = (p && p.distribute) || "freq";
  const table = buildHomophones(pool, distribute, rngFrom(`${(p && p.key) || ""}|${(p && p.pool) || "digits2"}|${(p && p.customPool) || ""}`));
  const rev = new Map();
  for (const [L, syms] of Object.entries(table)) for (const s of syms) rev.set(s, L);
  const t = String(text ?? "");
  const out = [];
  let i = 0;
  while (i < t.length) {
    if ((p && p.pool) !== "custom") {
      const two = t.slice(i, i + 2);
      if (/^\d\d$/.test(two)) {
        const L = rev.get(two);
        if (!L) throw new Error(`同音替换：符号 "${two}" 不在当前密表内（密钥/分配方式与加密时不一致，或密文被截断）。`);
        out.push(L); i += 2;
      } else { out.push(t[i]); i += 1; }
    } else {
      const L = rev.get(t[i]);
      out.push(L || t[i]); i += 1;
    }
  }
  return out.join("");
}

register({
  id: "homophonic", cat: "classic", name: "同音替换",
  desc: "一明文字母映射多个密文符号（00-99 数字池或自定义池）抗频率分析；密表由密钥+分配方式派生，轮转/随机两种选择",
  params: [
    { key: "pool", label: "符号池", type: "select", default: "digits2",
      options: [
        { value: "digits2", label: "两位数字 00-99（100 符号）" },
        { value: "custom", label: "自定义字符池" },
      ] },
    { key: "customPool", label: "自定义池（每字符一个同音符号，≥26 互异字符）", type: "text", default: "" },
    { key: "distribute", label: "符号分配", type: "select", default: "freq",
      options: [
        { value: "freq", label: "按英语词频（E 最多）" },
        { value: "even", label: "均分" },
      ] },
    { key: "selection", label: "选择方式", type: "select", default: "roundrobin",
      options: [
        { value: "roundrobin", label: "轮转（确定）" },
        { value: "random", label: "随机（按 seed）" },
      ] },
    { key: "key", label: "密钥（决定密表）", type: "text", default: "" },
    { key: "seed", label: "随机档种子", type: "number", default: 1 },
  ],
  encode: homophonicEncode,
  decode: homophonicDecode,
});

/* ================================================================
 * A2 双重列移位 doubleTrans
 * ================================================================ */
register({
  id: "doubleTrans", cat: "classic", name: "双重列移位",
  desc: "列移位连用两次（密钥1 加密后再用密钥2 加密，解密反序）；与「列移位」op 同口径（只保留 A-Z，按 key 字母序读列）",
  params: [
    { key: "key1", label: "密钥1", type: "text", default: "BATTLE" },
    { key: "key2", label: "密钥2", type: "text", default: "FIELD" },
  ],
  encode: (t, p) => columnarEncode(columnarEncode(t, (p && p.key1) || "BATTLE"), (p && p.key2) || "FIELD"),
  decode: (t, p) => columnarDecode(columnarDecode(t, (p && p.key2) || "FIELD"), (p && p.key1) || "BATTLE"),
});

/* ================================================================
 * A3 Pollux
 * ================================================================ */
function parsePolluxSpec(spec) {
  const parts = String(spec || "").split(/[,，\s]+/).filter(Boolean);
  if (parts.length !== 3)
    throw new Error(`Pollux：映射须为 3 组符号集（点,划,分隔），逗号或空格分隔，当前 ${parts.length} 组。`);
  const sets = parts.map((s) => [...s]);
  for (const s of sets) if (new Set(s).size !== s.length)
    throw new Error("Pollux：符号集内部有重复符号。");
  for (let a = 0; a < 3; a++) for (let b = a + 1; b < 3; b++)
    for (const ch of sets[a]) if (sets[b].includes(ch))
      throw new Error(`Pollux：符号 "${ch}" 同时出现在两组符号集里，解密会有二义性。`);
  return sets; // [dot, dash, sep]
}

/* 明文 → 摩斯符号流：. - 与分隔符 /（字母界），词界 = //（double）或 /（single） */
function morseSymbolStream(text, sepPolicy) {
  const words = String(text ?? "").toUpperCase().split(/\s+/).filter(Boolean);
  const bad = [];
  const streamWords = words.map((w) =>
    [...w].map((ch) => {
      const m = MORSE_REV[ch];
      if (!m) { bad.push(ch); return null; }
      return m;
    })
  );
  if (bad.length) {
    const uniq = [...new Set(bad)].map((c) => `"${c}"`).join(" ");
    throw new Error(`Pollux/Morbit：明文含摩斯不支持的字符 ${uniq}（支持 A-Z、0-9 与常见标点）。`);
  }
  const parts = [];
  streamWords.forEach((letters, wi) => {
    if (wi > 0) parts.push(sepPolicy === "double" ? "//" : "/");
    letters.forEach((m, li) => {
      if (li > 0) parts.push("/");
      parts.push(m);
    });
  });
  return parts.join("");
}

function polluxEncode(text, p) {
  const [dotSet, dashSet, sepSet] = parsePolluxSpec((p && p.mapSpec) || "047,158,2369");
  const sepPolicy = (p && p.sepPolicy) || "double";
  const stream = morseSymbolStream(text, sepPolicy);
  const selection = (p && p.selection) || "roundrobin";
  const rng = rngFrom(`${(p && p.seed) || 1}`);
  const cur = [0, 0, 0];
  const pick = (set, k) => {
    let idx;
    if (selection === "random") idx = Math.floor(rng() * set.length);
    else { idx = (cur[k] = cur[k] || 0) % set.length; cur[k]++; }
    return set[idx];
  };
  let out = "";
  for (const ch of stream) {
    if (ch === ".") out += pick(dotSet, 0);
    else if (ch === "-") out += pick(dashSet, 1);
    else out += pick(sepSet, 2);
  }
  return out;
}

function polluxDecode(text, p) {
  const [dotSet, dashSet, sepSet] = parsePolluxSpec((p && p.mapSpec) || "047,158,2369");
  const sepPolicy = (p && p.sepPolicy) || "double";
  const rev = new Map();
  for (const c of dotSet) rev.set(c, ".");
  for (const c of dashSet) rev.set(c, "-");
  for (const c of sepSet) rev.set(c, "/");
  const t = String(text ?? "").replace(/\s+/g, "");
  const unknown = [...t].find((c) => !rev.has(c));
  if (unknown !== undefined)
    throw new Error(`Pollux：密文符号 "${unknown}" 不在三组符号集内（先核对映射参数）。`);
  // 符号流 → 摩斯：单个 / = 字母界，连续 ≥2 = 词界（single 档无词界信息）
  let morse = "", letter = "";
  const flushLetter = () => { if (letter) { morse += (morse ? " " : "") + letter; letter = ""; } };
  let sepRun = 0;
  for (const c of t) {
    const s = rev.get(c);
    if (s === "/") { flushLetter(); sepRun++; }
    else {
      if (sepRun >= 2) morse += " / ";
      sepRun = 0;
      letter += s;
    }
  }
  flushLetter();
  void sepPolicy;
  return morseDecode(morse);
}

register({
  id: "pollux", cat: "classic", name: "Pollux 密码",
  desc: "摩斯衍生：点/划/分隔各映射一组符号（默认 047/158/2369），轮转或随机取用；词分隔双符号（默认，可往返）或单符号",
  params: [
    { key: "mapSpec", label: "映射（点,划,分隔 三组互斥符号集）", type: "text", default: "047,158,2369" },
    { key: "sepPolicy", label: "词分隔策略", type: "select", default: "double",
      options: [
        { value: "double", label: "双分隔符（词界=2 个 sep，可往返）" },
        { value: "single", label: "单分隔符（dCode 页面读法，词距丢失）" },
      ] },
    { key: "selection", label: "选择方式", type: "select", default: "roundrobin",
      options: [
        { value: "roundrobin", label: "轮转（确定）" },
        { value: "random", label: "随机（按 seed）" },
      ] },
    { key: "seed", label: "随机档种子", type: "number", default: 1 },
  ],
  encode: polluxEncode,
  decode: polluxDecode,
});

/* ================================================================
 * A4 Morbit
 * ================================================================ */
const MORBIT_PAIRS = ["..", ".-", "./", "-.", "--", "-/", "/.", "/-", "//"];

/* 9 字符密钥 → 秩表（稳定排序）：ranks[秩-1] = 标准对下标；任意 9 字符密钥的秩必为 1-9 排列 */
function morbitRanks(key) {
  const k = String(key || "");
  if (k.length !== 9)
    throw new Error(`Morbit：密钥须恰好 9 个字符（当前 ${k.length} 个）。`);
  return [...k].map((ch, i) => [ch, i])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] - b[1]))
    .map(([, i]) => i);
}

function morbitEncode(text, p) {
  const ranks = morbitRanks((p && p.key) || "MORSECODE");
  let stream = morseSymbolStream(text, "double"); // / = 字母界，// = 词界
  if (stream.length % 2 === 1) stream += "/";     // 奇数长补一个分隔符（dCode 示例同款）
  const pairIdx = new Map(MORBIT_PAIRS.map((pr, i) => [pr, i]));
  const digitOf = new Array(9).fill(0);
  ranks.forEach((pi, rank) => { digitOf[pi] = rank + 1; });
  let out = "";
  for (let i = 0; i < stream.length; i += 2) {
    const idx = pairIdx.get(stream.slice(i, i + 2));
    if (idx === undefined) throw new Error("Morbit：符号流含非法字符（仅 . - 与空白允许）。");
    out += digitOf[idx];
  }
  return out;
}

function morbitDecode(text, p) {
  const ranks = morbitRanks((p && p.key) || "MORSECODE");
  const t = String(text ?? "").replace(/[^1-9]/g, "");
  if (!t) throw new Error("Morbit：密文为空（仅接受数字 1-9）。");
  let stream = "";
  for (const d of t) stream += MORBIT_PAIRS[ranks[Number(d) - 1]];
  stream = stream.replace(/\/+$/, ""); // 尾部补位分隔符丢弃
  // / 字母界，连续 ≥2 = 词界
  let morse = "", letter = "";
  const flush = () => { if (letter) { morse += (morse ? " " : "") + letter; letter = ""; } };
  let sepRun = 0;
  for (const c of stream) {
    if (c === "/") { flush(); sepRun++; }
    else { if (sepRun >= 2) morse += " / "; sepRun = 0; letter += c; }
  }
  flush();
  return morseDecode(morse);
}

register({
  id: "morbit", cat: "classic", name: "Morbit 密码",
  desc: "摩斯衍生：含分隔符的摩斯流按两位一组（9 种对），9 字符密钥按字母序定秩映射数字 1-9；奇数长补分隔符",
  params: [
    { key: "key", label: "密钥（恰好 9 字符）", type: "text", default: "MORSECODE" },
  ],
  encode: morbitEncode,
  decode: morbitDecode,
});

/* ================================================================
 * A5 书卷密码 bookCipher
 * ================================================================ */
const stripPunct = (w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
const normWord = (w, policy) => (policy === "exact" ? w : stripPunct(w).toLowerCase());

function bookIndex(ref, policy) {
  const lines = String(ref || "").split(/\r?\n/);
  const words = [];
  for (let li = 0; li < lines.length; li++)
    for (const raw of lines[li].split(/\s+/).filter(Boolean))
      words.push({ raw, norm: normWord(raw, policy), line: li + 1 });
  return { lines, words };
}

function bookEncode(text, p) {
  const ref = String((p && p.refText) || "");
  if (!ref.trim()) throw new Error("书卷密码：共享文本为空——书卷密码必须先给一本「书」。");
  const mode = (p && p.mode) || "word";
  const policy = (p && p.matchPolicy) || "loose";
  const occurrence = (p && p.occurrence) || "first";
  const sep = ((p && p.sep) || ".").trim() || ".";
  const { words } = bookIndex(ref, policy);
  if (!words.length) throw new Error("书卷密码：共享文本没有任何单词。");
  const posByNorm = new Map();
  words.forEach((w, i) => {
    if (!posByNorm.has(w.norm)) posByNorm.set(w.norm, []);
    posByNorm.get(w.norm).push(i);
  });
  let cursor = -1;
  const nums = [];
  const missing = [];
  for (const tok of String(text ?? "").split(/\s+/).filter(Boolean)) {
    const nt = normWord(tok, policy);
    if (!nt) { nums.push("?"); continue; }
    const positions = posByNorm.get(nt);
    if (!positions) { missing.push(tok); continue; }
    if (mode === "word") {
      let chosen;
      if (occurrence === "next") {
        chosen = positions.find((i) => i > cursor);
        if (chosen === undefined) chosen = positions[0];
        cursor = chosen;
      } else chosen = positions[0];
      nums.push(String(chosen + 1));
    } else {
      // line-word：next=游标行之后首个出现行；first=总取首个出现行
      const linesAvail = [...new Set(words.filter((w) => w.norm === nt).map((w) => w.line))];
      let L;
      if (occurrence === "next") {
        L = linesAvail.find((l) => l > cursor) ?? linesAvail[0];
        cursor = L;
      } else L = linesAvail[0];
      // 行内第几词（按该行全部词计，不是第几个同词）
      let counter = 0, found = 0;
      for (const w of words) {
        if (w.line !== L) continue;
        counter++;
        if (!found && w.norm === nt) found = counter;
      }
      nums.push(`${L}${sep}${found}`);
    }
  }
  if (missing.length)
    throw new Error(`书卷密码：以下词在共享文本中找不到（换一本书或改匹配口径）：${[...new Set(missing)].slice(0, 10).join(" ")}${missing.length > 10 ? " …" : ""}`);
  return nums.join(sep);
}

function bookDecode(text, p) {
  const ref = String((p && p.refText) || "");
  if (!ref.trim()) throw new Error("书卷密码：共享文本为空——书卷密码必须先给一本「书」。");
  const mode = (p && p.mode) || "word";
  const policy = (p && p.matchPolicy) || "loose";
  const { words } = bookIndex(ref, policy);
  const t = String(text ?? "").trim();
  if (!t) return "";
  const out = [];
  if (mode === "word") {
    for (const g of t.split(/[^\d]+/).filter(Boolean)) {
      const n = Number(g);
      if (!Number.isInteger(n) || n < 1 || n > words.length)
        throw new Error(`书卷密码：编号 ${g} 超出共享文本词数（1-${words.length}）。`);
      out.push(words[n - 1].raw);
    }
  } else {
    for (const r of t.split(/\s+/).filter(Boolean)) {
      const mm = r.match(/^(\d+)\D(\d+)$/);
      if (!mm) throw new Error(`书卷密码：「${r}」不是 行.词 形式的编号（如 12.3）。`);
      const L = Number(mm[1]), W = Number(mm[2]);
      const lineWordsArr = words.filter((w) => w.line === L);
      if (!lineWordsArr.length) throw new Error(`书卷密码：共享文本没有第 ${L} 行。`);
      if (W < 1 || W > lineWordsArr.length)
        throw new Error(`书卷密码：第 ${L} 行只有 ${lineWordsArr.length} 个词，取不到第 ${W} 个。`);
      out.push(lineWordsArr[W - 1].raw);
    }
  }
  return out.join(" ");
}

register({
  id: "bookCipher", cat: "classic", name: "书卷密码",
  desc: "Beale 式编号指向共享文本：word=全序第 N 词；line-word=第 l 行第 w 词；first/next 两种取位，宽松/严格两种匹配",
  params: [
    { key: "refText", label: "共享文本（那本「书」）", type: "textarea", default: "" },
    { key: "mode", label: "编号制", type: "select", default: "word",
      options: [
        { value: "word", label: "word：全序第 N 词（1 起）" },
        { value: "line-word", label: "line-word：第 l 行第 w 词" },
      ] },
    { key: "occurrence", label: "取位策略", type: "select", default: "first",
      options: [
        { value: "first", label: "first：总取首次出现" },
        { value: "next", label: "next：顺序向后推进（更像真实用法）" },
      ] },
    { key: "matchPolicy", label: "匹配口径", type: "select", default: "loose",
      options: [
        { value: "loose", label: "宽松：忽略大小写与首尾标点" },
        { value: "exact", label: "严格：整词完全一致" },
      ] },
    { key: "sep", label: "输出分隔符", type: "text", default: "." },
  ],
  encode: bookEncode,
  decode: bookDecode,
});

/* ================================================================
 * A6 转动格栅 turningGrille
 * ================================================================ */
const rotCW = (r, c, n) => [c, n - 1 - r];
function orbitOf(r, c, n) {
  const seen = [];
  let cur = [r, c];
  for (let k = 0; k < 4; k++) {
    const key = cur[0] * n + cur[1];
    if (!seen.includes(key)) seen.push(key);
    cur = rotCW(cur[0], cur[1], n);
  }
  return seen.sort((a, b) => a - b);
}

function parseGrille(spec, n) {
  const s = String(spec || "").replace(/\s+/g, "");
  if (s.length !== n * n)
    throw new Error(`转动格栅：格栅须 ${n}×${n}=${n * n} 个字符（# = 孔，. = 实），当前 ${s.length} 个。`);
  const bad = [...s].find((ch) => ch !== "#" && ch !== ".");
  if (bad !== undefined) throw new Error(`转动格栅：格栅字符 "${bad}" 非法（仅 # 与 .）。`);
  const holes = new Set();
  [...s].forEach((ch, i) => { if (ch === "#") holes.add(i); });
  if (n % 2 === 1 && holes.has((n >> 1) * n + (n >> 1)))
    throw new Error("转动格栅：奇数尺寸的中心格自映射（旋转不动），不能作为孔——请改为 .");
  const seenOrbits = new Set();
  for (const h of holes) {
    const orb = orbitOf(Math.floor(h / n), h % n, n);
    if (seenOrbits.has(orb[0]))
      throw new Error(`转动格栅：轨道 (${Math.floor(orb[0] / n)},${orb[0] % n}) 上有多个孔——每条 4 旋转轨道恰好允许 1 个孔。`);
    seenOrbits.add(orb[0]);
  }
  const half = (n * n - (n % 2)) / 4;
  if (seenOrbits.size !== half)
    throw new Error(`转动格栅：孔数 ${seenOrbits.size} ≠ 轨道数 ${half}（每轨道恰 1 孔才能 4 次旋转填满全格）。`);
  return holes;
}

function canonicalGrille(n) {
  const holes = new Set();
  const q = n >> 1;
  const lim = n % 2 ? q + 1 : q;
  for (let r = 0; r < lim; r++)
    for (let c = 0; c < lim; c++) {
      if (n % 2 === 1 && r === q && c === q) continue; // 中心跳过
      holes.add(orbitOf(r, c, n)[0]); // 轨道代表 = 序号最小格（确定性规范形）
    }
  return holes;
}

function grilleHoles(param, n) {
  const s = String(param || "").trim();
  if (!s) return canonicalGrille(n);
  const seedMatch = s.match(/^seed:(.+)$/);
  if (seedMatch) {
    const rng = rngFrom(seedMatch[1]);
    const holes = new Set();
    const seen = new Set(); // 轨道去重：奇数 N 的 (q+1)² 区域会重复踩到同一轨道
    const q = n >> 1;
    const lim = n % 2 ? q + 1 : q;
    for (let r = 0; r < lim; r++)
      for (let c = 0; c < lim; c++) {
        if (n % 2 === 1 && r === q && c === q) continue;
        const orb = orbitOf(r, c, n);
        if (seen.has(orb[0])) continue;
        seen.add(orb[0]);
        holes.add(orb[Math.floor(rng() * orb.length)]);
      }
    return holes;
  }
  return parseGrille(s, n);
}

function grilleRun(text, n, holesParam, dir, padChar, decodeMode) {
  if (!Number.isInteger(n) || n < 2 || n > 12)
    throw new Error("转动格栅：尺寸 N 须为 2-12 的整数。");
  const holes = grilleHoles(holesParam, n);
  const rot = dir === "ccw" ? (r, c) => [n - 1 - c, r] : rotCW;
  const passes = [];
  let cur = new Set(holes);
  for (let k = 0; k < 4; k++) {
    passes.push([...cur].sort((a, b) => a - b).map((i) => [Math.floor(i / n), i % n]));
    cur = new Set([...cur].map((i) => { const [r, c] = rot(Math.floor(i / n), i % n, n); return r * n + c; }));
  }
  const capacity = passes.reduce((a, b) => a + b.length, 0);
  const grid = Array.from({ length: n }, () => new Array(n).fill(""));
  if (!decodeMode) {
    const chars = [...String(text ?? "")];
    if (chars.length > capacity)
      throw new Error(`转动格栅：明文 ${chars.length} 字符超出 ${n}×${n} 格栅容量 ${capacity}（换大尺寸或拆段）。`);
    while (chars.length < capacity) chars.push(padChar || "X");
    let idx = 0;
    for (const open of passes)
      for (const [r, c] of open) grid[r][c] = chars[idx++];
    return grid.map((row) => row.join("")).join("");
  } else {
    const t = String(text ?? "").replace(/\s+/g, "");
    const want = n * n - (n % 2); // 奇数 N 中心格禁用，密文比满格少 1
    if (t.length !== want)
      throw new Error(`转动格栅：密文须恰 ${want} 字符（${n}×${n}${n % 2 ? " 去中心格" : " 满格"}），当前 ${t.length} 个。`);
    let k = 0;
    for (let i = 0; i < n * n; i++) {
      if (n % 2 === 1 && i === (n >> 1) * n + (n >> 1)) continue; // 跳过中心
      grid[Math.floor(i / n)][i % n] = t[k++];
    }
    let out = "";
    for (const open of passes)
      for (const [r, c] of open) out += grid[r][c];
    return out;
  }
}

register({
  id: "turningGrille", cat: "classic", name: "转动格栅",
  desc: "Fleissner 格栅：N×N 格栅 4 次 90° 旋转逐格填入/读出（顺/逆时针）；格栅串 # 孔 . 实 / seed:种子 / 空=规范形；每轨道恰 1 孔",
  params: [
    { key: "n", label: "尺寸 N（2-12）", type: "number", default: 6 },
    { key: "grille", label: "格栅（# 孔 . 实；空=规范形；seed:xx 随机）", type: "textarea", default: "" },
    { key: "dir", label: "旋转方向", type: "select", default: "cw",
      options: [
        { value: "cw", label: "顺时针（默认）" },
        { value: "ccw", label: "逆时针" },
      ] },
    { key: "padChar", label: "补位字符", type: "text", default: "X" },
  ],
  encode: (t, p) => grilleRun(t, Number((p && p.n) || 6), (p && p.grille) || "", (p && p.dir) || "cw", (p && p.padChar) || "X", false),
  decode: (t, p) => grilleRun(t, Number((p && p.n) || 6), (p && p.grille) || "", (p && p.dir) || "cw", (p && p.padChar) || "X", true),
});

/* ================================================================
 * A7 Kenny 语 kenny（fancy：与培根同族）
 * ================================================================ */
const KENNY_DIGITS = ["M", "P", "F"]; // M=0 P=1 F=2（dCode 表核实：A=MMM … Z=FFP）
const KENNY_TRI = (v) => KENNY_DIGITS[Math.floor(v / 9)] + KENNY_DIGITS[Math.floor(v / 3) % 3] + KENNY_DIGITS[v % 3];
const KENNY_MAP = {};
for (let i = 0; i < 26; i++) KENNY_MAP[String.fromCharCode(65 + i)] = KENNY_TRI(i);
const KENNY_REV = {};
for (const [L, tri] of Object.entries(KENNY_MAP)) KENNY_REV[tri] = L;
KENNY_REV["FFF"] = " "; // dCode 未分配；本实现扩展档：FFF = 空格

function kennyEncode(text, p) {
  const spaceMode = (p && p.spaceMode) || "fff";
  const out = [];
  for (const ch of String(text ?? "")) {
    const up = ch.toUpperCase();
    if (KENNY_MAP[up]) out.push(KENNY_MAP[up]);
    else if (up === " " && spaceMode === "fff") out.push("FFF");
    // 其余字符丢弃（dCode 仅定义 A-Z）
  }
  return out.join("");
}

function kennyDecode(text, p) {
  const spaceMode = (p && p.spaceMode) || "fff";
  const t = String(text ?? "").replace(/[^mpfMPF]/g, "");
  if (!t) throw new Error("Kenny：密文为空（仅由 m/p/f 三种字母组成，每 3 个一组）。");
  if (t.length % 3 !== 0)
    throw new Error(`Kenny：密文长度 ${t.length} 不是 3 的倍数（可能缺字符或混入了他组）。`);
  const out = [];
  for (let i = 0; i < t.length; i += 3) {
    const tri = t.slice(i, i + 3).toUpperCase();
    const L = KENNY_REV[tri];
    if (tri === "FFF" && spaceMode !== "fff")
      throw new Error("Kenny：遇到 FFF，但空格档选了「严格」——dCode 原表未定义 FFF。");
    if (!L) throw new Error(`Kenny：三连音 "${tri}" 不在码表内。`);
    out.push(L);
  }
  return out.join("");
}

register({
  id: "kenny", cat: "fancy", name: "Kenny 语",
  desc: "South Park Kenny 语：M=0/P=1/F=2 三进制，A=MMM … Z=FFP 每字母三音节；FFF 可作空格（扩展档）",
  params: [
    { key: "spaceMode", label: "空格档", type: "select", default: "fff",
      options: [
        { value: "fff", label: "FFF=空格（扩展，推荐）" },
        { value: "strict", label: "严格（dCode 原表无 FFF，报错）" },
      ] },
  ],
  encode: kennyEncode,
  decode: kennyDecode,
});

/* 供测试/上层复用 */
export {
  homophonicEncode, homophonicDecode, buildHomophones,
  polluxEncode, polluxDecode, parsePolluxSpec,
  morbitEncode, morbitDecode, morbitRanks, MORBIT_PAIRS,
  bookEncode, bookDecode,
  grilleRun, parseGrille, canonicalGrille,
  kennyEncode, kennyDecode, KENNY_MAP, KENNY_REV,
};
