import { A26, big, binom, lineDiff, longestCommonSubstr, parseNums, randInt, runOp, shuffled } from "../lib/util.js";

const NS = "dcode-extras-2026-10/";
const TEXT = NS + "cat-text";
const NUM = NS + "cat-numeral";
const MATH = NS + "cat-math";
const CIPHER = NS + "cat-cipher";

const P = (key, label, ph = "") => ({ key, label, type: "text", default: "", placeholder: ph });
const SEL = (key, label, def, opts) => ({ key, label, type: "select", default: def, options: opts.map((o) => (typeof o === "string" ? { value: o, label: o } : o)) });
const oid = (s) => NS + "d4-" + s;
const R = (id, cat, name, desc, params, fn) => runOp(oid(id), cat, name, desc, fn, params);
const C = (id, cat, name, desc, params, encode, decode) => ({ id: oid(id), cat, name, desc, params, encode, decode });

const B = (s, what = "整数") => {
  const v = big(s);
  if (v === null) throw new Error(`需要${what}`);
  return v;
};
const INT = (s, lo, hi, what = "整数") => {
  const v = Number(s);
  if (!Number.isInteger(v) || v < lo || v > hi) throw new Error(`${what}需为 ${lo}..${hi}`);
  return v;
};
const linesOf = (t) => String(t).replace(/\r\n?/g, "\n").split("\n");
const wordsOf = (t) => String(t).match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) || [];
const tokensOf = (t) => String(t).split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);
const stripAccents = (t) => String(t).normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const kb = (n) => {
  if (n >= 1e9) return (n / 1e9).toFixed(3).replace(/\.?0+$/, "") + " G";
  if (n >= 1e6) return (n / 1e6).toFixed(3).replace(/\.?0+$/, "") + " M";
  if (n >= 1e3) return (n / 1e3).toFixed(3).replace(/\.?0+$/, "") + " k";
  return String(n);
};

function gcdBig(a, b) {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b) { const t = a % b; a = b; b = t; }
  return a;
}
function fr(n, d = 1n) {
  if (d === 0n) throw new Error("分母不能为 0");
  if (d < 0n) { n = -n; d = -d; }
  const g = gcdBig(n, d) || 1n;
  return { n: n / g, d: d / g };
}
const frAdd = (a, b) => fr(a.n * b.d + b.n * a.d, a.d * b.d);
const frSub = (a, b) => fr(a.n * b.d - b.n * a.d, a.d * b.d);
const frMul = (a, b) => fr(a.n * b.n, a.d * b.d);
const frDiv = (a, b) => {
  if (b.n === 0n) throw new Error("除以 0");
  return fr(a.n * b.d, a.d * b.n);
};

function parseFracExpr(src) {
  const s = String(src).replace(/\s+/g, "");
  if (!s) throw new Error("需要算式");
  if (s.length > 20000) throw new Error("算式长度上限 20000 字符");
  let i = 0;
  const peek = () => s[i];
  function number() {
    let j = i, dot = false;
    while (j < s.length && /[0-9.]/.test(s[j])) { if (s[j] === ".") { if (dot) throw new Error("小数点重复"); dot = true; } j++; }
    if (j === i) throw new Error(`位置 ${i} 需要数字`);
    const raw = s.slice(i, j);
    i = j;
    if (dot) {
      const [a, b = ""] = raw.split(".");
      const d = 10n ** BigInt(b.length);
      return fr(BigInt((a || "0") + b), d);
    }
    return fr(BigInt(raw));
  }
  function factor() {
    if (peek() === "(") { i++; const v = expr(); if (peek() !== ")") throw new Error("缺少右括号"); i++; return v; }
    if (peek() === "+" || peek() === "-") { const neg = peek() === "-"; i++; const v = factor(); return neg ? fr(-v.n, v.d) : v; }
    return number();
  }
  function term() {
    let v = factor();
    while (peek() === "*" || peek() === "/") { const op = s[i++]; const w = factor(); v = op === "*" ? frMul(v, w) : frDiv(v, w); }
    return v;
  }
  function expr() {
    let v = term();
    while (peek() === "+" || peek() === "-") { const op = s[i++]; const w = term(); v = op === "+" ? frAdd(v, w) : frSub(v, w); }
    return v;
  }
  const v = expr();
  if (i !== s.length) throw new Error(`位置 ${i} 存在无法解析的字符「${s[i]}」`);
  return v;
}
const frText = (v) => {
  if (v.d === 1n) return v.n.toString();
  const dec = Number(v.n) / Number(v.d);
  return `${v.n}/${v.d} ≈ ${Number.isFinite(dec) ? dec.toPrecision(12).replace(/\.?0+$/, "") : "?"}`;
};

function soundex(word) {
  const w = stripAccents(String(word)).toUpperCase().replace(/[^A-Z]/g, "");
  if (!w) throw new Error("Soundex 需要字母");
  const map = { B: "1", F: "1", P: "1", V: "1", C: "2", G: "2", J: "2", K: "2", Q: "2", S: "2", X: "2", Z: "2", D: "3", T: "3", L: "4", M: "5", N: "5", R: "6" };
  let out = w[0];
  let prev = map[w[0]] || "";
  for (let i = 1; i < w.length && out.length < 4; i++) {
    const c = map[w[i]] || "";
    if (c && c !== prev) out += c;
    if (w[i] !== "H" && w[i] !== "W") prev = c;
  }
  return (out + "000").slice(0, 4);
}

function metaphone(word) {
  let w = stripAccents(String(word)).toUpperCase().replace(/[^A-Z]/g, "");
  if (!w) throw new Error("Metaphone 需要字母");
  if (/^(AE|GN|KN|PN|WR)/.test(w)) w = w.slice(1);
  if (/^WH/.test(w)) w = "W" + w.slice(2);
  if (w[0] === "X") w = "S" + w.slice(1);
  let out = "";
  const isV = (c) => "AEIOU".includes(c);
  for (let i = 0; i < w.length; i++) {
    const c = w[i], prev = w[i - 1] || "", next = w[i + 1] || "", next2 = w[i + 2] || "";
    if (c === prev && c !== "C") continue;
    switch (c) {
      case "A": case "E": case "I": case "O": case "U":
        if (i === 0) out += c;
        break;
      case "B":
        if (!(i === w.length - 1 && prev === "M")) out += "B";
        break;
      case "C":
        if (next === "I" && next2 === "A") out += "X";
        else if (next === "H") { out += "X"; i++; }
        else if ("IEY".includes(next)) out += "S";
        else out += "K";
        break;
      case "D":
        if (next === "G" && "IEY".includes(next2)) { out += "J"; i += 2; }
        else out += "D";
        break;
      case "F": out += "F"; break;
      case "G":
        if (next === "H" && !(i + 2 === w.length)) { i++; break; }
        if (next === "N" && i + 2 === w.length) break;
        if ("IEY".includes(next)) out += "J";
        else out += "K";
        break;
      case "H":
        if (isV(next) && !"CSPTG".includes(prev)) out += "H";
        break;
      case "J": out += "J"; break;
      case "K":
        if (prev !== "C") out += "K";
        break;
      case "L": out += "L"; break;
      case "M": out += "M"; break;
      case "N": out += "N"; break;
      case "P":
        if (next === "H") { out += "F"; i++; } else out += "P";
        break;
      case "Q": out += "K"; break;
      case "R": out += "R"; break;
      case "S":
        if (next === "H") { out += "X"; i++; }
        else if (next === "I" && (next2 === "O" || next2 === "A")) out += "X";
        else out += "S";
        break;
      case "T":
        if (next === "H") { out += "0"; i++; }
        else if (next === "I" && (next2 === "O" || next2 === "A")) out += "X";
        else if (next === "C" && next2 === "H") { i++; }
        else out += "T";
        break;
      case "V": out += "F"; break;
      case "W": case "Y":
        if (isV(next)) out += c;
        break;
      case "X": out += "KS"; break;
      case "Z": out += "S"; break;
      default: break;
    }
  }
  return out;
}

const EN_STOP = new Set("the be to of and a in that have i it for not on with he as you do at this but his by from they we say her she or an will my one all would there their what so up out if about who get which go me when make can like time no just him know take people into year your good some could them see other than then now look only come its over think also back after use two how our work first well way even new want because any these give day most us".split(" "));
const FR_STOP = new Set("le la les de des du un une et est en que qui dans pour pas sur ce il elle nous vous ils elles avec ne se plus par au aux son sa ses comme mais ou où donc or ni car je tu on y avoir être fait plus moins très".split(" "));
const ES_STOP = new Set("el la los las de del un una y es en que por para con no se su al lo como más pero sus le ya o este esta entre cuando muy sin sobre también me hasta hay donde quien desde todo nos durante".split(" "));
const DE_STOP = new Set("der die das und ist in den von zu mit sich des auf für nicht ein eine als auch es an werden aus er hat dass sie nach wird bei einer um am sind noch wie einem über einen so zum war haben nur oder aber vor zur bis mehr durch man sein wurde sei".split(" "));
const IT_STOP = new Set("il lo la i gli le di del della e è in che per con non un una si al come più ma anche suo sua questo questa tra fra essere ha hanno nel nella dei delle da su".split(" "));

const HOMO = { a: "а", c: "с", e: "е", h: "һ", i: "і", j: "ј", l: "ӏ", o: "о", p: "р", s: "ѕ", x: "х", y: "у", A: "А", B: "В", C: "С", E: "Е", H: "Н", I: "І", J: "Ј", K: "К", M: "М", O: "О", P: "Р", S: "Ѕ", T: "Т", X: "Х", Y: "У" };
const HOMO_REV = Object.fromEntries(Object.entries(HOMO).map(([k, v]) => [v, k]));
const KEY_NEI = {
  q: "wa", w: "qes", e: "wrd", r: "etf", t: "ryg", y: "tuh", u: "yij", i: "uok", o: "ipl", p: "ol",
  a: "qsz", s: "awdx", d: "sefc", f: "drgv", g: "fthb", h: "gyjn", j: "hukm", k: "jil,", l: "kop",
  z: "asx", x: "zsdc", c: "xdfv", v: "cfgb", b: "vghn", n: "bhjm", m: "njk",
};
const UPSIDE = { a: "ɐ", b: "q", c: "ɔ", d: "p", e: "ǝ", f: "ɟ", g: "ƃ", h: "ɥ", i: "ᴉ", j: "ɾ", k: "ʞ", l: "l", m: "ɯ", n: "u", o: "o", p: "d", q: "b", r: "ɹ", s: "s", t: "ʇ", u: "n", v: "ʌ", w: "ʍ", x: "x", y: "ʎ", z: "z", "0": "0", "1": "Ɩ", "2": "ᄅ", "3": "Ɛ", "4": "ㄣ", "5": "ϛ", "6": "9", "7": "ㄥ", "8": "8", "9": "6", ".": "˙", ",": "'", "'": ",", "?": "¿", "!": "¡", "(": ")", ")": "(", "[": "]", "]": "[", "{": "}", "}": "{", "<": ">", ">": "<", "_": "‾" };

export const OPS = [
  R("acronym", TEXT, "首字母缩写生成（Acronymes）", "短语 → 首字母缩写、每词前 4 字母组合、词数；仅生成方向，不做缩写反查",
    [SEL("mode", "输出", "all", [{ value: "all", label: "全部" }, { value: "initial", label: "仅首字母" }])],
    (t, p) => {
      const ws = wordsOf(t);
      if (!ws.length) throw new Error("需要至少一个单词");
      const initials = ws.map((w) => w[0].toUpperCase()).join("");
      const head = ws.map((w) => w.toUpperCase().slice(0, 4)).join("-");
      if (String((p && p.mode) || "all") === "initial") return initials;
      return [`首字母缩写: ${initials}`, `每词前 4 字母: ${head}`, `单词数: ${ws.length}`].join("\n");
    }),

  R("expr-frac", TEXT, "有理数表达式求值（Analyseur d'Expression Rationnelle）", "精确有理数四则运算与括号（支持小数、负号、分数），输出既约分数与近似值；不解析变量或函数",
    [], (t) => {
      const v = parseFracExpr(t);
      return `既约分数: ${v.n}/${v.d}\n小数: ${v.d === 1n ? v.n.toString() : frText(v).split(" ≈ ")[1]}`;
    }),

  R("round", TEXT, "四舍五入 / 取整计算器", "按指定小数位四舍五入（半远离零），或向下/向上/截断取整",
    [P("decimals", "小数位", "2"), SEL("mode", "模式", "round", [{ value: "round", label: "四舍五入" }, { value: "floor", label: "向下取整" }, { value: "ceil", label: "向上取整" }, { value: "trunc", label: "截断" }])],
    (t, p) => {
      const d = INT((p && p.decimals) || "2", 0, 12, "小数位");
      const mode = String((p && p.mode) || "round");
      const nums = parseNums(t);
      if (!nums.length) throw new Error("需要数字");
      return nums.map((x) => {
        const f = 10 ** d;
        let v;
        if (mode === "floor") v = Math.floor(x * f) / f;
        else if (mode === "ceil") v = Math.ceil(x * f) / f;
        else if (mode === "trunc") v = Math.trunc(x * f) / f;
        else v = (Math.sign(x) * Math.round(Math.abs(x) * f)) / f;
        return d === 0 ? String(v) : v.toFixed(d);
      }).join("\n");
    }),

  R("count-substr", TEXT, "表达式 / 子串出现次数", "统计固定子串在文本中的出现次数（可选重叠匹配）",
    [P("needle", "子串", ""), SEL("overlap", "重叠", "non", [{ value: "non", label: "不重叠" }, { value: "oui", label: "允许重叠" }])],
    (t, p) => {
      const needle = String((p && p.needle) || "");
      if (!needle) throw new Error("需要子串");
      const s = String(t);
      let n = 0, i = 0;
      while (true) {
        const j = s.indexOf(needle, i);
        if (j < 0) break;
        n++;
        i = j + (String((p && p.overlap) || "non") === "oui" ? 1 : needle.length);
      }
      return `出现次数: ${n}`;
    }),

  R("word-count", TEXT, "词数 / 字符数统计（Compteur de Mots）", "统计单词、字符（含/不含空白）、行、句、段落数",
    [], (t) => {
      const s = String(t);
      const words = s.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) || [];
      const lines = linesOf(s);
      const sentences = s.split(/[.!?…]+(?=\s|$)/).filter((x) => x.trim());
      const paras = s.replace(/\r/g, "").split(/\n\s*\n/).filter((x) => x.trim());
      return [
        `单词数: ${words.length}`,
        `字符数（含空白）: ${[...s].length}`,
        `字符数（不含空白）: ${[...s.replace(/\s/gu, "")].length}`,
        `行数: ${lines.length}`,
        `句子数: ${sentences.length}`,
        `段落数: ${paras.length}`,
      ].join("\n");
    }),

  R("text-diff", TEXT, "两段文本差异（Différences entre 2 Textes）", "按行做 LCS diff，输出 = / - / + 前缀；两段文本用分隔行 --- 分开",
    [P("sep", "分隔行", "---")],
    (t, p) => {
      const sep = String((p && p.sep) || "---");
      const s = String(t).replace(/\r\n?/g, "\n");
      const idx = s.indexOf(sep);
      if (idx < 0) throw new Error(`需要分隔行「${sep}」`);
      const a = s.slice(0, idx).replace(/\n$/, "").split("\n");
      const b = s.slice(idx + sep.length).replace(/^\n/, "").split("\n");
      return lineDiff(a, b).map((d) => d.t + " " + d.line).join("\n");
    }),

  R("list-dupes", TEXT, "列表重复项检测（Doublons）", "按行/逗号切分列表，列出出现次数 ≥2 的项及次数",
    [], (t) => {
      const items = tokensOf(String(t).replace(/[\r\n]+/g, ","));
      if (!items.length) throw new Error("需要列表");
      const cnt = new Map();
      for (const x of items) cnt.set(x, (cnt.get(x) || 0) + 1);
      const dup = [...cnt.entries()].filter(([, n]) => n > 1);
      if (!dup.length) return "无重复项";
      return dup.map(([x, n]) => `${x} ×${n}`).join("\n");
    }),

  R("block-split", TEXT, "按字母块切分（Découpage en Blocs de Lettres）", "去除空白后每 N 个字符切一块，以空格分隔",
    [P("n", "块大小", "5")],
    (t, p) => {
      const n = INT((p && p.n) || "5", 1, 1000, "块大小");
      const s = String(t).replace(/\s+/gu, "");
      if (!s) throw new Error("需要字母");
      const out = [];
      for (let i = 0; i < s.length; i += n) out.push(s.slice(i, i + n));
      return out.join(" ");
    }),

  R("text-split", TEXT, "文本切分器（Découpeur de Texte）", "按分隔符切分，或按固定宽度硬切；逐项输出",
    [SEL("mode", "模式", "sep", [{ value: "sep", label: "按分隔符" }, { value: "width", label: "按宽度" }]), P("sep", "分隔符", ","), P("width", "宽度", "20")],
    (t, p) => {
      const mode = String((p && p.mode) || "sep");
      if (mode === "width") {
        const w = INT((p && p.width) || "20", 1, 1000, "宽度");
        const s = String(t);
        const out = [];
        for (let i = 0; i < s.length; i += w) out.push(s.slice(i, i + w));
        return out.join("\n");
      }
      const sep = String((p && p.sep) || ",");
      if (!sep) throw new Error("需要分隔符");
      return String(t).split(sep).map((x, i) => `[${i + 1}] ${x}`).join("\n");
    }),

  R("plagiarism", TEXT, "文本相似度 / 抄袭检测（Détecteur de Plagiat）", "两段文本用分隔行 --- 分开；输出词集合 Jaccard、共词比例、最长公共子串",
    [P("sep", "分隔行", "---")],
    (t, p) => {
      const sep = String((p && p.sep) || "---");
      const s = String(t);
      const idx = s.indexOf(sep);
      if (idx < 0) throw new Error(`需要分隔行「${sep}」`);
      const a = s.slice(0, idx), b = s.slice(idx + sep.length);
      const wa = new Set(wordsOf(a).map((w) => w.toLowerCase()));
      const wb = new Set(wordsOf(b).map((w) => w.toLowerCase()));
      if (!wa.size || !wb.size) throw new Error("两段文本都需要单词");
      let inter = 0;
      for (const w of wa) if (wb.has(w)) inter++;
      const jac = inter / (wa.size + wb.size - inter);
      const contain = inter / Math.min(wa.size, wb.size);
      const lcs = longestCommonSubstr(a, b);
      return [
        `词集合 Jaccard: ${(jac * 100).toFixed(2)}%`,
        `共词覆盖: ${(contain * 100).toFixed(2)}%`,
        `最长公共子串: ${lcs.length} 字符${lcs ? `（${lcs.slice(0, 80)}）` : ""}`,
        jac >= 0.8 ? "判定: 高度相似" : jac >= 0.5 ? "判定: 中度相似" : "判定: 差异较大",
      ].join("\n");
    }),

  R("set-diff", TEXT, "列表差集（Eléments Non Communs）", "两段列表用分隔行 --- 分开；输出只在第一段出现的项",
    [P("sep", "分隔行", "---")],
    (t, p) => {
      const sep = String((p && p.sep) || "---");
      const s = String(t);
      const idx = s.indexOf(sep);
      if (idx < 0) throw new Error(`需要分隔行「${sep}」`);
      const a = tokensOf(s.slice(0, idx)), b = new Set(tokensOf(s.slice(idx + sep.length)));
      if (!a.length) throw new Error("第一段列表为空");
      const out = [...new Set(a)].filter((x) => !b.has(x));
      return out.length ? out.join("\n") : "无差集项";
    }),

  R("set-common", TEXT, "列表交集（Eléments en Commun）", "两段列表用分隔行 --- 分开；输出共同项",
    [P("sep", "分隔行", "---")],
    (t, p) => {
      const sep = String((p && p.sep) || "---");
      const s = String(t);
      const idx = s.indexOf(sep);
      if (idx < 0) throw new Error(`需要分隔行「${sep}」`);
      const a = new Set(tokensOf(s.slice(0, idx)));
      const b = tokensOf(s.slice(idx + sep.length));
      if (!a.size || !b.length) throw new Error("两段列表都不能为空");
      const out = [...new Set(b)].filter((x) => a.has(x));
      return out.length ? out.join("\n") : "无共同项";
    }),

  R("letter-extract", TEXT, "抽取字母（Extraction de Lettres / Acrostiche）", "按模式抽取：每词首字母、每词第 N 字母、元音、辅音、或全部字母",
    [SEL("mode", "模式", "acrostic", [{ value: "acrostic", label: "每词首字母" }, { value: "nth", label: "每词第 N 字母" }, { value: "vowels", label: "元音" }, { value: "consonants", label: "辅音" }, { value: "letters", label: "全部字母" }]), P("n", "N", "1")],
    (t, p) => {
      const mode = String((p && p.mode) || "acrostic");
      const ws = wordsOf(t);
      if (!ws.length) throw new Error("需要文本");
      if (mode === "acrostic") return ws.map((w) => w[0]).join("");
      if (mode === "nth") {
        const n = INT((p && p.n) || "1", 1, 1000, "N");
        return ws.map((w) => w[n - 1] || "").join("");
      }
      const letters = [...String(t)].filter((c) => /\p{L}/u.test(c));
      if (mode === "vowels") return letters.filter((c) => /[aeiouyàâäéèêëîïôöùûüœæ]/i.test(c)).join("");
      if (mode === "consonants") return letters.filter((c) => !/[aeiouyàâäéèêëîïôöùûüœæ]/i.test(c)).join("");
      return letters.join("");
    }),

  R("typo-gen", TEXT, "拼写错误变体生成（Fautes de Frappe）", "按 QWERTY 邻键为每个字母生成替换变体，每行一个；上限 500 行",
    [], (t) => {
      const ws = wordsOf(t);
      if (!ws.length) throw new Error("需要单词");
      const out = new Set();
      for (const w of ws) {
        for (let i = 0; i < w.length; i++) {
          const nei = KEY_NEI[w[i].toLowerCase()] || "";
          for (const c of nei) {
            const v = w.slice(0, i) + c + w.slice(i + 1);
            out.add(v);
            if (out.size >= 500) break;
          }
          if (out.size >= 500) break;
        }
        if (out.size >= 500) break;
      }
      return [...out].join("\n");
    }),

  R("combo-filter", TEXT, "组合 / 行过滤（Filtres de Combinaisons）", "按包含子串或正则过滤输入行；输出匹配行",
    [SEL("mode", "模式", "contains", [{ value: "contains", label: "包含子串" }, { value: "regex", label: "正则匹配" }, { value: "exclude", label: "排除子串" }]), P("pat", "模式", "")],
    (t, p) => {
      const pat = String((p && p.pat) || "");
      if (!pat) throw new Error("需要过滤模式");
      const mode = String((p && p.mode) || "contains");
      let re = null;
      if (mode === "regex") { try { re = new RegExp(pat, "u"); } catch (e) { throw new Error("正则无效: " + e.message); } }
      const out = linesOf(t).filter((line) => mode === "regex" ? re.test(line) : mode === "exclude" ? !line.includes(pat) : line.includes(pat));
      return out.join("\n");
    }),

  C("homoglyph", TEXT, "同形字生成（Homoglyphes / Homographes）", "拉丁字母 → 视觉相同的西里尔/希腊字母；decode 还原；仅覆盖内置映射表",
    [], (t) => {
      let out = "";
      for (const ch of String(t)) out += HOMO[ch] || ch;
      return out;
    }, (t) => {
      let out = "";
      for (const ch of String(t)) out += HOMO_REV[ch] || ch;
      return out;
    }),

  R("abbrev", TEXT, "缩写列表生成（Liste d'Abréviations）", "对短语生成首字母缩写、前 3 字母缩写、辅音骨架三种候选",
    [], (t) => {
      const ws = wordsOf(t);
      if (!ws.length) throw new Error("需要短语");
      const initial = ws.map((w) => w[0].toUpperCase()).join("");
      const pre3 = ws.map((w) => w.toUpperCase().slice(0, 3)).join("");
      const cons = ws.map((w) => w.toUpperCase().replace(/[^BCDFGHJKLMNPQRSTVWXZ]/g, "").slice(0, 4)).join("");
      return [`首字母: ${initial}`, `前3字母: ${pre3}`, `辅音骨架: ${cons || "(无)"}`].join("\n");
    }),

  R("markov", TEXT, "马尔可夫文本生成（Chaîne de Markov）", "用输入文本建一阶词马尔可夫链，按输入哈希确定的伪随机序列生成 N 个词；不引入外部语料",
    [P("count", "生成词数", "30")],
    (t, p) => {
      const ws = wordsOf(t).map((w) => w.toLowerCase());
      if (ws.length < 2) throw new Error("至少需要 2 个词");
      const n = INT((p && p.count) || "30", 1, 2000, "生成词数");
      const next = new Map();
      for (let i = 0; i + 1 < ws.length; i++) {
        if (!next.has(ws[i])) next.set(ws[i], []);
        next.get(ws[i]).push(ws[i + 1]);
      }
      let seed = 2166136261;
      for (const ch of String(t)) { seed ^= ch.codePointAt(0); seed = Math.imul(seed, 16777619) >>> 0; }
      const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed; };
      let cur = ws[rnd() % ws.length];
      const out = [cur];
      for (let i = 1; i < n; i++) {
        const arr = next.get(cur);
        cur = arr && arr.length ? arr[rnd() % arr.length] : ws[rnd() % ws.length];
        out.push(cur);
      }
      return out.join(" ");
    }),

  R("benford", TEXT, "本福特定律分析（Loi de Benford）", "统计数字首位分布并与 Benford 期望对比；仅分析非零数字",
    [], (t) => {
      const nums = String(t).match(/-?\d+(?:\.\d+)?/g) || [];
      if (!nums.length) throw new Error("需要数字");
      const cnt = new Array(10).fill(0);
      let total = 0;
      for (const raw of nums) {
        const m = raw.replace(/^[-+]/, "").replace(/^0+/, "").match(/[1-9]/);
        if (!m) continue;
        cnt[Number(m[0])]++;
        total++;
      }
      if (!total) throw new Error("没有非零首位数字");
      return Array.from({ length: 9 }, (_, i) => {
        const d = i + 1, obs = (cnt[d] / total) * 100, exp = Math.log10(1 + 1 / d) * 100;
        return `${d}: 观测 ${obs.toFixed(2)}% / 期望 ${exp.toFixed(2)}% (${cnt[d]}/${total})`;
      }).join("\n");
    }),

  R("confusion", TEXT, "混淆矩阵（Matrice de Confusion）", "输入每行 actual,predicted；输出标签矩阵、准确率与各标签 precision/recall",
    [], (t) => {
      const pairs = linesOf(t).map((l) => l.trim()).filter(Boolean).map((l) => l.split(/[,;\s]+/)).filter((a) => a.length >= 2);
      if (!pairs.length) throw new Error("需要 actual,predicted 行");
      const labels = [...new Set(pairs.flatMap((p) => [p[0], p[1]]))].sort();
      const m = new Map(labels.map((l) => [l, new Map(labels.map((x) => [x, 0]))]));
      for (const [a, p] of pairs) m.get(a).set(p, m.get(a).get(p) + 1);
      const total = pairs.length;
      const correct = pairs.filter(([a, p]) => a === p).length;
      const out = [`标签: ${labels.join(", ")}`, `矩阵(行=actual,列=predicted):`, "\t" + labels.join("\t")];
      for (const a of labels) out.push(a + "\t" + labels.map((p) => m.get(a).get(p)).join("\t"));
      out.push(`准确率: ${(correct / total * 100).toFixed(2)}% (${correct}/${total})`);
      for (const l of labels) {
        const tp = m.get(l).get(l);
        const fp = labels.filter((x) => x !== l).reduce((s, x) => s + m.get(x).get(l), 0);
        const fn = labels.filter((x) => x !== l).reduce((s, x) => s + m.get(l).get(x), 0);
        const prec = tp + fp ? tp / (tp + fp) : 0;
        const rec = tp + fn ? tp / (tp + fn) : 0;
        out.push(`${l}: precision ${(prec * 100).toFixed(1)}% recall ${(rec * 100).toFixed(1)}%`);
      }
      return out.join("\n");
    }),

  R("list-stats", TEXT, "列表统计（最大/最小/均值/中位数/分位）", "mode=max|min|mean|geomean|weighted|median|quantile|quartiles；weighted 输入每行 value,weight；quantile 用 p 参数（0..1）",
    [SEL("mode", "统计量", "mean", ["max", "min", "mean", "geomean", "weighted", "median", "quantile", "quartiles"]), P("p", "分位 p", "0.5")],
    (t, p) => {
      const mode = String((p && p.mode) || "mean");
      if (mode === "weighted") {
        const rows = linesOf(t).map((l) => l.split(/[,;\s]+/).filter(Boolean)).filter((a) => a.length >= 2).map(([v, w]) => [Number(v), Number(w)]);
        if (!rows.length || rows.some(([v, w]) => !Number.isFinite(v) || !Number.isFinite(w))) throw new Error("需要 value,weight 行");
        const sw = rows.reduce((s, [, w]) => s + w, 0);
        if (!sw) throw new Error("权重和为 0");
        return String(rows.reduce((s, [v, w]) => s + v * w, 0) / sw);
      }
      const nums = parseNums(t);
      if (!nums.length) throw new Error("需要数字");
      const s = nums.slice().sort((a, b) => a - b);
      const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
      if (mode === "max") return String(s[s.length - 1]);
      if (mode === "min") return String(s[0]);
      if (mode === "mean") return String(mean(nums));
      if (mode === "geomean") {
        if (nums.some((x) => x <= 0)) throw new Error("几何平均需要全为正数");
        return String(Math.exp(mean(nums.map((x) => Math.log(x)))));
      }
      if (mode === "median") return String(s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2);
      if (mode === "quantile") {
        const q = Number((p && p.p) || "0.5");
        if (!(q >= 0 && q <= 1)) throw new Error("p 需在 0..1");
        const pos = (s.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
        return String(s[lo] + (s[hi] - s[lo]) * (pos - lo));
      }
      const med = (a) => a.length % 2 ? a[(a.length - 1) / 2] : (a[a.length / 2 - 1] + a[a.length / 2]) / 2;
      const mid = Math.floor(s.length / 2);
      const lower = s.slice(0, mid), upper = s.length % 2 ? s.slice(mid + 1) : s.slice(mid);
      return `Q1=${med(lower)} Q2=${med(s)} Q3=${med(upper)} IQR=${med(upper) - med(lower)}`;
    }),

  R("metaphone", TEXT, "Metaphone 语音编码", "经典 Metaphone 规则（英语），输出音近编码；非英语拼写仅作近似",
    [], (t) => wordsOf(t).map((w) => `${w} → ${metaphone(w)}`).join("\n")),

  R("char-count", TEXT, "字符分类统计（Nombre de Caractères）", "统计字母、数字、空白、标点、Unicode 码点与 UTF-8 字节数",
    [], (t) => {
      const s = String(t);
      const chars = [...s];
      const count = (re) => chars.filter((c) => re.test(c)).length;
      return [
        `字母: ${count(/\p{L}/u)}`,
        `数字: ${count(/\p{N}/u)}`,
        `空白: ${count(/\s/u)}`,
        `标点: ${count(/\p{P}/u)}`,
        `码点数: ${chars.length}`,
        `UTF-8 字节数: ${new TextEncoder().encode(s).length}`,
      ].join("\n");
    }),

  R("numbers-ending", TEXT, "以指定数字结尾的数（Nombres Finissant Par…）", "列出 0..max 中十进制表示以 suffix 结尾的数；上限 1000 个结果",
    [P("max", "最大值", "100"), P("suffix", "结尾数字", "7")],
    (t, p) => {
      const max = INT((p && p.max) || String(t || "100"), 0, 1e9, "最大值");
      const suffix = String((p && p.suffix) || "7");
      if (!/^\d+$/.test(suffix)) throw new Error("结尾必须是数字");
      const out = [];
      for (let i = 0; i <= max && out.length < 1000; i++) if (String(i).endsWith(suffix)) out.push(i);
      return out.length ? out.join(", ") : "没有符合条件的数";
    }),

  R("odd-even", TEXT, "奇数 / 偶数分类（Nombres Pairs ou Impairs）", "把数字列表分为奇数与偶数，并给出计数",
    [], (t) => {
      const nums = parseNums(t);
      if (!nums.length) throw new Error("需要数字");
      const odd = nums.filter((x) => Math.abs(x % 2) === 1);
      const even = nums.filter((x) => x % 2 === 0);
      return [`奇数 (${odd.length}): ${odd.join(", ") || "无"}`, `偶数 (${even.length}): ${even.join(", ") || "无"}`].join("\n");
    }),

  R("common-substr", TEXT, "最长公共子串（Point Commun）", "两段文本用分隔行 --- 分开，输出最长公共子串及其长度",
    [P("sep", "分隔行", "---")],
    (t, p) => {
      const sep = String((p && p.sep) || "---");
      const s = String(t);
      const idx = s.indexOf(sep);
      if (idx < 0) throw new Error(`需要分隔行「${sep}」`);
      const a = s.slice(0, idx), b = s.slice(idx + sep.length);
      if (!a || !b) throw new Error("两段文本都不能为空");
      const lcs = longestCommonSubstr(a, b);
      return `长度: ${lcs.length}\n最长公共子串: ${lcs || "(无)"}`;
    }),

  R("precision-recall", TEXT, "精确率 / 召回率 / 敏感度 / 特异度", "输入 TP,FP,FN,TN 四项；输出 precision、recall/sensitivity、specificity、F1、accuracy",
    [], (t) => {
      const v = parseNums(t);
      if (v.length !== 4 || v.some((x) => x < 0 || !Number.isInteger(x))) throw new Error("需要 4 个非负整数 TP,FP,FN,TN");
      const [tp, fp, fn, tn] = v;
      const d = (a, b, name) => b ? (a / b * 100).toFixed(2) + "%" : `${name} 无定义（分母 0）`;
      return [
        `precision = ${d(tp, tp + fp, "precision")}`,
        `recall / sensitivity = ${d(tp, tp + fn, "recall")}`,
        `specificity = ${d(tn, tn + fp, "specificity")}`,
        `F1 = ${d(2 * tp, 2 * tp + fp + fn, "F1")}`,
        `accuracy = ${d(tp + tn, tp + tn + fp + fn, "accuracy")}`,
      ].join("\n");
    }),

  R("lang-detect", TEXT, "语言识别（Reconnaissance de Langue）", "基于 EN/FR/ES/DE/IT 常用词命中率打分，输出前三候选；短文本结果不可靠",
    [], (t) => {
      const ws = wordsOf(t).map((w) => stripAccents(w.toLowerCase()));
      if (ws.length < 3) throw new Error("至少需要 3 个词");
      const sets = [["英语 EN", EN_STOP], ["法语 FR", FR_STOP], ["西班牙语 ES", ES_STOP], ["德语 DE", DE_STOP], ["意大利语 IT", IT_STOP]];
      const scored = sets.map(([name, set]) => [name, ws.filter((w) => set.has(w)).length / ws.length]);
      scored.sort((a, b) => b[1] - a[1]);
      return scored.slice(0, 3).map(([n, s]) => `${n}: ${(s * 100).toFixed(1)}%`).join("\n");
    }),

  R("sign", TEXT, "正负号判定（Signe Positif/Négatif）", "逐个数字输出正/负/零",
    [], (t) => {
      const nums = parseNums(t);
      if (!nums.length) throw new Error("需要数字");
      return nums.map((x) => `${x}: ${x > 0 ? "正 (+)" : x < 0 ? "负 (-)" : "零"}`).join("\n");
    }),

  R("simplify-frac", TEXT, "有理式化简（Simplificateur d'Expressions Rationnelles）", "精确计算有理数四则表达式并化为既约分数；不处理含变量的多项式约分",
    [], (t) => {
      const v = parseFracExpr(t);
      return `${v.n}/${v.d}`;
    }),

  R("soundex", TEXT, "Soundex 语音编码", "美国 Soundex（首字母 + 3 位数字，H/W 分隔规则）",
    [], (t) => wordsOf(t).map((w) => `${w} → ${soundex(w)}`).join("\n")),

  R("strip-spaces", TEXT, "删除空格（Suppression des Espaces）", "删除全部空白，或仅删除行内空白保留换行；可选把连续空白压成一个空格",
    [SEL("mode", "模式", "all", [{ value: "all", label: "删除全部空白" }, { value: "inline", label: "仅删除行内空白" }, { value: "squash", label: "连续空白压成一个空格" }])],
    (t, p) => {
      const mode = String((p && p.mode) || "all");
      const s = String(t);
      if (mode === "inline") return linesOf(s).map((l) => l.replace(/[^\S\r\n]+/g, "")).join("\n");
      if (mode === "squash") return s.replace(/\s+/g, " ").trim();
      return s.replace(/\s+/g, "");
    }),

  R("syllables", TEXT, "音节切分（Séparateur de Syllabes）", "英语式启发式音节切分（元音组 + 后续辅音）；不保证符合词典音节",
    [], (t) => {
      const out = [];
      for (const w of wordsOf(t)) {
        const s = w.toLowerCase();
        if (s.length <= 3) { out.push(w); continue; }
        const cut = s.replace(/([aeiouy]+)([bcdfghjklmnpqrstvwxz])([bcdfghjklmnpqrstvwxz]?)(?=[aeiouy])/g, "$1$2-$3");
        out.push(cut.split("-").join("-"));
      }
      return out.join("\n");
    }),

  R("comma-sep", TEXT, "逗号分隔（Séparation par des Virgules）", "列表 ↔ 逗号分隔文本；to=每行/项 → 逗号串，from=逗号/分号串 → 每行一项",
    [SEL("mode", "方向", "to", [{ value: "to", label: "→ 逗号串" }, { value: "from", label: "→ 每行一项" }]), P("sep", "分隔符", ",")],
    (t, p) => {
      const mode = String((p && p.mode) || "to");
      const sep = String((p && p.sep) || ",");
      if (mode === "to") return tokensOf(String(t).replace(/[\r\n]+/g, ",")).join(sep + " ");
      return String(t).split(new RegExp("[" + sep.replace(/[\\\]^-]/g, "\\$&") + ";]")).map((x) => x.trim()).filter(Boolean).join("\n");
    }),

  R("sort-letters", TEXT, "字母排序（Tri de Lettres）", "对文本中所有字母/字符排序；可选去重、倒序、忽略大小写",
    [SEL("order", "顺序", "asc", [{ value: "asc", label: "升序" }, { value: "desc", label: "降序" }]), SEL("uniq", "去重", "non", [{ value: "non", label: "保留重复" }, { value: "oui", label: "去重" }]), SEL("case", "大小写", "keep", [{ value: "keep", label: "保留" }, { value: "lower", label: "统一小写" }])],
    (t, p) => {
      let a = [...String(t)].filter((c) => /\S/u.test(c));
      if (String((p && p.case) || "keep") === "lower") a = a.map((c) => c.toLowerCase());
      if (String((p && p.uniq) || "non") === "oui") a = [...new Set(a)];
      a.sort((x, y) => x.localeCompare(y, "en"));
      if (String((p && p.order) || "asc") === "desc") a.reverse();
      return a.join("");
    }),

  R("sort-list", TEXT, "列表排序（Tri de Liste）", "按行/逗号切分后排序：字典序、数值、长度、倒序",
    [SEL("mode", "排序", "alpha", [{ value: "alpha", label: "字典序" }, { value: "numeric", label: "数值" }, { value: "length", label: "长度" }, { value: "desc", label: "字典序倒序" }])],
    (t, p) => {
      const a = tokensOf(String(t).replace(/[\r\n]+/g, ","));
      if (!a.length) throw new Error("需要列表");
      const mode = String((p && p.mode) || "alpha");
      if (mode === "numeric") a.sort((x, y) => Number(x) - Number(y));
      else if (mode === "length") a.sort((x, y) => x.length - y.length || x.localeCompare(y));
      else a.sort((x, y) => x.localeCompare(y, "en"));
      if (mode === "desc") a.reverse();
      return a.join("\n");
    }),

  R("pass-variants", TEXT, "密码变体生成（Variations de Mot de Passe）", "生成大小写、Leet 替换与首尾数字变体；上限 300 个",
    [], (t) => {
      const base = String(t).trim();
      if (!base) throw new Error("需要基础词");
      const leet = { a: ["4", "@"], e: ["3"], i: ["1", "!"], o: ["0"], s: ["5", "$"], t: ["7"], b: ["8"], g: ["9"] };
      const out = new Set([base, base.toLowerCase(), base.toUpperCase(), base[0].toUpperCase() + base.slice(1).toLowerCase()]);
      const low = base.toLowerCase();
      out.add(low);
      for (let i = 0; i < low.length; i++) {
        const rep = leet[low[i]];
        if (!rep) continue;
        for (const r of rep) out.add(low.slice(0, i) + r + low.slice(i + 1));
      }
      let all = low;
      for (let i = 0; i < low.length; i++) {
        const rep = leet[low[i]];
        if (rep) all = all.slice(0, i) + rep[0] + all.slice(i + 1);
      }
      out.add(all);
      for (const d of ["0", "1", "12", "123", "2024", "!"]) { out.add(base + d); out.add(d + base); }
      return [...out].slice(0, 300).join("\n");
    }),

  R("vowel-consonant", TEXT, "元音与辅音（Voyelles et Consonnes）", "统计/列出元音与辅音（含法语重音字母）",
    [], (t) => {
      const letters = [...String(t)].filter((c) => /\p{L}/u.test(c));
      const isV = (c) => /[aeiouyàâäéèêëîïôöùûüœæ]/i.test(c);
      const v = letters.filter(isV), c = letters.filter((x) => !isV(x));
      return [`元音 (${v.length}): ${v.join("")}`, `辅音 (${c.length}): ${c.join("")}`, `元音占比: ${letters.length ? (v.length / letters.length * 100).toFixed(1) : 0}%`].join("\n");
    }),

  R("strip-zeros", TEXT, "去除前导零（Zeros Initiaux）", "去除整数前导零、保留符号与小数；全零整数输出 0",
    [], (t) => {
      const out = linesOf(t).map((raw) => {
        const s = raw.trim();
        if (!s || !/^[-+]?\d*\.?\d+$/.test(s)) return raw;
        const sign = s[0] === "-" ? "-" : s[0] === "+" ? "+" : "";
        let body = sign ? s.slice(1) : s;
        if (body.includes(".")) {
          let [a, b] = body.split(".");
          a = a.replace(/^0+/, "") || "0";
          return sign + a + "." + b;
        }
        body = body.replace(/^0+/, "") || "0";
        return sign + body;
      });
      return out.join("\n");
    }),

  R("bit-positions", TEXT, "二进制 1 位位置（Position des Bits）", "整数 → 二进制，列出所有 1 位的位置（从 0 与从 1 起）及位权",
    [], (t) => {
      const n = B(t);
      if (n < 0n) throw new Error("需要非负整数");
      const bin = n.toString(2);
      const pos0 = [], pos1 = [];
      for (let i = 0; i < bin.length; i++) if (bin[i] === "1") { const p = bin.length - 1 - i; pos0.push(p); pos1.push(p + 1); }
      return [`二进制: ${bin}`, `1 位位置（从 0）: ${pos0.join(", ") || "无"}`, `1 位位置（从 1）: ${pos1.join(", ") || "无"}`, `位权: ${pos0.map((p) => 2n ** BigInt(p)).join(", ") || "无"}`].join("\n");
    }),

  R("lfsr", TEXT, "线性反馈移位寄存器（LFSR）", "Fibonacci LFSR：seed 为二进制种子，taps 为 1 起抽头位置（如 4,1），输出 count 位序列",
    [P("seed", "种子(二进制)", "1001"), P("taps", "抽头", "4,1"), P("count", "输出位数", "20")],
    (t, p) => {
      const seed = String((p && p.seed) || "1001").trim();
      if (!/^[01]+$/.test(seed)) throw new Error("种子必须是二进制串");
      if (/^0+$/.test(seed)) throw new Error("种子不能全零");
      const taps = String((p && p.taps) || "4,1").split(/[,;\s]+/).filter(Boolean).map((x) => INT(x, 1, seed.length, "抽头"));
      const count = INT((p && p.count) || "20", 1, 100000, "输出位数");
      let state = [...seed].map(Number);
      let out = "";
      for (let i = 0; i < count; i++) {
        out += state[0];
        const fb = taps.reduce((x, tap) => x ^ state[tap - 1], 0);
        state = [fb, ...state.slice(0, -1)];
      }
      return `序列: ${out}\n周期检查: ${new Set(Array.from({ length: Math.min(4096, 2 ** seed.length) }, () => { const s = state.join(""); const fb = taps.reduce((x, tap) => x ^ state[tap - 1], 0); state = [fb, ...state.slice(0, -1)]; return s; })).size}`;
    }),

  R("android-pattern", TEXT, "Android 解锁图案（Schéma de Verrouillage）", "输入 1-9 数字路径；输出坐标、是否合法（不能跳未经过的中间点、不能重复）",
    [], (t) => {
      const path = String(t).replace(/[^1-9]/g, "").split("").map(Number);
      if (!path.length) throw new Error("需要 1-9 组成的路径");
      const coord = (d) => [Math.floor((d - 1) % 3) + 1, Math.floor((d - 1) / 3) + 1];
      const mid = { "1-3": 2, "3-1": 2, "1-7": 4, "7-1": 4, "3-9": 6, "9-3": 6, "7-9": 8, "9-7": 8, "1-9": 5, "9-1": 5, "3-7": 5, "7-3": 5, "2-8": 5, "8-2": 5, "4-6": 5, "6-4": 5 };
      const seen = new Set();
      const reasons = [];
      for (let i = 0; i < path.length; i++) {
        const d = path[i];
        if (seen.has(d)) reasons.push(`数字 ${d} 重复`);
        if (i > 0) {
          const need = mid[path[i - 1] + "-" + d];
          if (need && !seen.has(need)) reasons.push(`${path[i - 1]}→${d} 跳过未访问的 ${need}`);
        }
        seen.add(d);
      }
      return [
        `路径: ${path.join(" → ")}`,
        `坐标(列,行): ${path.map((d) => { const [x, y] = coord(d); return `${d}=(${x},${y})`; }).join(" ")}`,
        `合法性: ${reasons.length ? "非法" : "合法"}`,
        ...(reasons.length ? reasons : []),
      ].join("\n");
    }),

  R("uuid", TEXT, "UUID 生成 / 解析", "mode=generate 生成 UUID v4（CSPRNG）；mode=parse 解析版本、变体与字段",
    [SEL("mode", "模式", "generate", [{ value: "generate", label: "生成 v4" }, { value: "parse", label: "解析" }])],
    (t, p) => {
      if (String((p && p.mode) || "generate") === "generate") {
        const b = new Uint8Array(16);
        for (let i = 0; i < 16; i += 4) b.set(randBytes4(), i);
        b[6] = (b[6] & 0x0f) | 0x40;
        b[8] = (b[8] & 0x3f) | 0x80;
        const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
        return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
      }
      const s = String(t).trim().replace(/^\{|\}$/g, "").toLowerCase();
      const m = s.match(/^([0-9a-f]{8})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{12})$/);
      if (!m) throw new Error("UUID 格式无效");
      const variant = "89ab".includes(m[4][0]) ? "RFC 4122" : "非 RFC 变体";
      return [`版本: ${parseInt(m[3][0], 16)}`, `变体: ${variant}`, `时间低位/高: ${m[1]}/${m[2]}`, `节点: ${m[5]}`, `规范化: ${m[0]}`].join("\n");
    }),

  R("int32", TEXT, "32 位整数（Entiers 32 Bits）", "十进制整数 → 有符号/无符号 32 位、十六进制、二进制（按 2 的补码截断）",
    [], (t) => {
      const nums = parseNums(t);
      if (!nums.length || nums.some((x) => !Number.isInteger(x))) throw new Error("需要整数");
      return nums.map((x) => {
        const u = BigInt.asUintN(32, BigInt(x));
        const s = BigInt.asIntN(32, BigInt(x));
        return `${x}: signed=${s} unsigned=${u} hex=0x${u.toString(16).toUpperCase().padStart(8, "0")} bin=${u.toString(2).padStart(32, "0")}`;
      }).join("\n");
    }),

  R("bitcalc", TEXT, "按位计算器（Calculatrice Bit-à-Bit）", "对两个 32 位整数做 AND/OR/XOR/NOT/SHL/SHR，输出十进制、十六进制、二进制",
    [SEL("op", "运算", "AND", ["AND", "OR", "XOR", "NOT", "SHL", "SHR"]), P("b", "第二个数", "0")],
    (t, p) => {
      const a = BigInt.asUintN(32, B(t));
      const b = BigInt.asUintN(32, BigInt(Number((p && p.b) || "0") || 0));
      const op = String((p && p.op) || "AND");
      let r;
      if (op === "AND") r = a & b;
      else if (op === "OR") r = a | b;
      else if (op === "XOR") r = a ^ b;
      else if (op === "NOT") r = BigInt.asUintN(32, ~a);
      else if (op === "SHL") r = BigInt.asUintN(32, a << (b & 31n));
      else if (op === "SHR") r = a >> (b & 31n);
      else throw new Error("未知运算");
      return `十进制: ${r}\n十六进制: 0x${r.toString(16).toUpperCase().padStart(8, "0")}\n二进制: ${r.toString(2).padStart(32, "0")}`;
    }),

  R("keypad-art", TEXT, "数字键盘绘图（Dessin sur Clavier Numérique）", "把 1-9 路径画在标准数字键盘布局上；显示访问顺序与坐标",
    [], (t) => {
      const path = String(t).replace(/[^1-9]/g, "").split("").map(Number);
      if (!path.length) throw new Error("需要 1-9 数字");
      const layout = [["7", "8", "9"], ["4", "5", "6"], ["1", "2", "3"]];
      const order = new Map(path.map((d, i) => [d, i + 1]));
      const grid = layout.map((row) => row.map((d) => order.has(Number(d)) ? String(order.get(Number(d))).padStart(2) : " .").join(" "));
      return ["键盘布局（数字=第几步）:", ...grid, `坐标: ${path.map((d) => { const x = (d - 1) % 3, y = 2 - Math.floor((d - 1) / 3); return `${d}=(${x},${y})`; }).join(" ")}`].join("\n");
    }),
  C("zbase32", TEXT, "Z-Base-32 编码", "z-base-32 字母表（ybndrfg8ejkmcpqxot1uwisza345h769）按 5 bit 分组；无填充，decode 忽略空白",
    [], (t) => base32Encode(new TextEncoder().encode(String(t)), ZB32), (t) => new TextDecoder().decode(base32Decode(t, ZB32))),

  C("excess3", TEXT, "余 3 码（Excess-3 / Stibitz）", "每个十进制数字加 3 后输出 4 位二进制；decode 反向",
    [], (t) => {
      const s = String(t).replace(/\s+/g, "");
      if (!/^\d+$/.test(s)) throw new Error("需要十进制数字");
      return [...s].map((d) => (Number(d) + 3).toString(2).padStart(4, "0")).join(" ");
    }, (t) => {
      const bits = String(t).replace(/[^01]/g, "");
      if (bits.length % 4) throw new Error("位数需为 4 的倍数");
      let out = "";
      for (let i = 0; i < bits.length; i += 4) {
        const v = parseInt(bits.slice(i, i + 4), 2) - 3;
        if (v < 0 || v > 9) throw new Error(`第 ${i / 4 + 1} 组不是合法余 3 码`);
        out += v;
      }
      return out;
    }),

  C("zalgo", TEXT, "Zalgo 组合字符（Ecriture Zalgo）", "在每个字符后附加组合用变音符号（U+0300..U+036F）；decode 去除组合记号并 NFC 还原",
    [SEL("level", "强度", "2", ["1", "2", "3"])], (t, p) => {
      const lv = INT((p && p.level) || "2", 1, 3, "强度");
      let out = "";
      for (const ch of String(t)) {
        out += ch;
        const cp = ch.codePointAt(0);
        for (let k = 0; k < lv; k++) out += String.fromCharCode(0x0300 + ((cp * 7 + k * 13) % 0x70));
      }
      return out;
    }, (t) => String(t).normalize("NFD").replace(/[\u0300-\u036f\u1ab0-\u1aff\u1dc0-\u1dff\u20d0-\u20ff\ufe20-\ufe2f]/g, "").normalize("NFC")),

  C("zwsp", TEXT, "零宽空格隐写（Espace Invisible ZWSP）", "UTF-8 字节按位映射为 U+200B(0)/U+200C(1)；decode 只读取这两种字符",
    [], (t) => {
      const bytes = new TextEncoder().encode(String(t));
      let out = "";
      for (const b of bytes) for (let i = 7; i >= 0; i--) out += (b >> i) & 1 ? "\u200c" : "\u200b";
      return out;
    }, (t) => {
      const bits = [...String(t)].filter((c) => c === "\u200b" || c === "\u200c").map((c) => c === "\u200c" ? 1 : 0);
      if (!bits.length || bits.length % 8) throw new Error("零宽字符位数不是 8 的倍数");
      const bytes = new Uint8Array(bits.length / 8);
      for (let i = 0; i < bytes.length; i++) bytes[i] = bits.slice(i * 8, i * 8 + 8).reduce((a, b) => (a << 1) | b, 0);
      return new TextDecoder().decode(bytes);
    }),

  R("barcode1d", TEXT, "一维条码模块串（EAN-8 / POSTNET / PLANET）", "输出条码的 1/0 模块串与校验位；不生成 PNG（PNG 见主程序 barcodeGen）",
    [SEL("sym", "制式", "ean8", ["ean8", "postnet", "planet"]), P("data", "数据", "")],
    (t, p) => {
      const sym = String((p && p.sym) || "ean8");
      const data = String((p && p.data) || t || "").replace(/\s+/g, "");
      if (sym === "ean8") {
        if (!/^\d{7,8}$/.test(data)) throw new Error("EAN-8 需要 7 或 8 位数字");
        const d7 = data.slice(0, 7);
        const chk = ean8Check(d7);
        if (data.length === 8 && data[7] !== String(chk)) throw new Error(`EAN-8 校验位应为 ${chk}`);
        let pat = "101";
        for (let i = 0; i < 4; i++) pat += EAN_L[Number(d7[i])];
        pat += "01010";
        for (let i = 4; i < 7; i++) pat += EAN_R[Number(d7[i])];
        pat += EAN_R[chk] + "101";
        return `数据: ${d7}${chk}\n校验位: ${chk}\n模块数: ${pat.length}\n模块串: ${pat}`;
      }
      if (!/^\d+$/.test(data)) throw new Error("POSTNET/PLANET 需要数字");
      const sum = [...data].reduce((a, c) => a + Number(c), 0);
      const chk = (10 - (sum % 10)) % 10;
      const pat = "1" + [...data + chk].map((d) => POSTNET[Number(d)]).join("") + "1";
      return `数据: ${data}${chk}\n校验位: ${chk}\n模块数: ${pat.length}\n模块串: ${pat}`;
    }),

  C("base26", NUM, "Base 26 字母计数（Chiffre Base 26）", "正整数 ↔ 双射 26 进制（A=1…Z=26, AA=27）；不是 A1Z26 逐字母替换",
    [], (t) => {
      let n = B(t);
      if (n <= 0n) throw new Error("需要正整数");
      let out = "";
      while (n > 0n) { n -= 1n; out = String.fromCharCode(65 + Number(n % 26n)) + out; n /= 26n; }
      return out;
    }, (t) => {
      const s = String(t).toUpperCase().replace(/[^A-Z]/g, "");
      if (!s) throw new Error("需要字母");
      let n = 0n;
      for (const c of s) n = n * 26n + BigInt(c.charCodeAt(0) - 64);
      return n.toString();
    }),

  C("base37", NUM, "Base 37 编码（Chiffre Base 37）", "整数 ↔ 37 进制，字母表 0-9 A-Z 空格（空格=36）；decode 忽略大小写",
    [], (t) => {
      let n = B(t);
      const neg = n < 0n;
      if (neg) n = -n;
      if (n === 0n) return "0";
      let out = "";
      while (n > 0n) { out = B37[Number(n % 37n)] + out; n /= 37n; }
      return (neg ? "-" : "") + out;
    }, (t) => {
      const s = String(t).toUpperCase().replace(/^\s+|\s+$/g, "");
      if (!s) throw new Error("需要 base37 字符串");
      const neg = s[0] === "-";
      const body = neg ? s.slice(1) : s;
      let n = 0n;
      for (const c of body) {
        const v = B37.indexOf(c);
        if (v < 0) throw new Error(`字符「${c}」不在 base37 字母表`);
        n = n * 37n + BigInt(v);
      }
      return (neg ? "-" : "") + n.toString();
    }),

  C("fib-coding", TEXT, "斐波那契编码（Codage de Fibonacci / Zeckendorf）", "Zeckendorf 表示 + 终止位 11；encode 正整数，decode 比特串",
    [], (t) => {
      const n = B(t);
      if (n <= 0n) throw new Error("需要正整数");
      const fibs = [1n, 2n];
      while (fibs[fibs.length - 1] <= n) fibs.push(fibs[fibs.length - 1] + fibs[fibs.length - 2]);
      let x = n, bits = new Array(fibs.length).fill("0");
      for (let i = fibs.length - 1; i >= 0; i--) if (fibs[i] <= x) { x -= fibs[i]; bits[i] = "1"; }
      if (x !== 0n) throw new Error("内部错误：Zeckendorf 分解失败");
      while (bits.length && bits[bits.length - 1] === "0") bits.pop();
      return bits.join("") + "1";
    }, (t) => {
      const s = String(t).replace(/[^01]/g, "");
      if (!s.endsWith("1") || s.length < 2) throw new Error("斐波那契编码必须以 1 结尾");
      const body = s.slice(0, -1);
      const fibs = [1n, 2n];
      while (fibs.length < body.length + 1) fibs.push(fibs[fibs.length - 1] + fibs[fibs.length - 2]);
      let n = 0n;
      for (let i = 0; i < body.length; i++) if (body[i] === "1") n += fibs[i];
      return n.toString();
    }),

  C("negafib-coding", TEXT, "负斐波那契编码（Codage de NegaFibonacci）", "负斐波那契数列 1,-1,2,-3,5,-8… 的 0/1 表示（无相邻 1）；decode 求和",
    [], (t) => {
      const n = B(t);
      if (n === 0n) return "0";
      const seq = [1n, -1n];
      while (seq.length < 60) seq.push(seq[seq.length - 2] - seq[seq.length - 1]);
      const memo = new Set();
      const lim = (n < 0n ? -n : n) * 4n + 1000n;
      const search = (rem, idx, chosen) => {
        if (rem === 0n) return chosen;
        if (idx < 0) return null;
        const ar = rem < 0n ? -rem : rem;
        if (ar > lim) return null;
        const key = rem + ":" + idx;
        if (memo.has(key)) return null;
        for (let i = idx; i >= 0; i--) {
          const f = seq[i];
          const af = f < 0n ? -f : f;
          if (af > lim) continue;
          const r = search(rem - f, i - 2, [...chosen, i]);
          if (r !== null) return r;
        }
        memo.add(key);
        return null;
      };
      const chosen = search(n, seq.length - 1, []);
      if (chosen === null) throw new Error("负斐波那契表示失败（输入过大）");
      const top = Math.max(...chosen);
      const bits = new Array(top + 1).fill("0");
      for (const i of chosen) bits[top - i] = "1";
      return bits.join("");
    }, (t) => {
      const s = String(t).replace(/[^01]/g, "");
      if (!s || /11/.test(s)) throw new Error("负斐波那契编码不能有相邻 1");
      const seq = [1n, -1n];
      while (seq.length < s.length) seq.push(seq[seq.length - 2] - seq[seq.length - 1]);
      let n = 0n;
      for (let i = 0; i < s.length; i++) if (s[s.length - 1 - i] === "1") n += seq[i];
      return n.toString();
    }),

  R("kaprekar", MATH, "Kaprekar 变换（Algorithme de Kaprekar）", "对 4 位以内数字反复「降序排列 − 升序排列」，输出序列直到 6174 或循环",
    [], (t) => {
      let s = String(t).trim();
      if (!/^\d{1,4}$/.test(s)) throw new Error("需要 1..4 位数字");
      s = s.padStart(4, "0");
      const seen = new Set();
      const out = [s];
      for (let step = 0; step < 20; step++) {
        const desc = [...s].sort((a, b) => Number(b) - Number(a)).join("");
        const asc = [...s].sort((a, b) => Number(a) - Number(b)).join("");
        const v = String(Number(desc) - Number(asc)).padStart(4, "0");
        out.push(`${desc} - ${asc} = ${v}`);
        if (v === "6174" || seen.has(v)) { s = v; break; }
        seen.add(v);
        s = v;
      }
      return out.join("\n");
    }),

  R("polya", MATH, "Pólya 猜想检验（Liouville 和）", "计算 Liouville λ(n)=(-1)^Ω(n) 的前缀和，找 ≤max 的第一个正项（Pólya 猜想反例极大，边界内通常为 0 项）",
    [P("max", "上限", "10000")],
    (t, p) => {
      const max = INT((p && p.max) || String(t || "10000"), 1, 2000000, "上限");
      const spf = new Int32Array(max + 1);
      for (let i = 2; i <= max; i++) if (!spf[i]) for (let j = i; j <= max; j += i) if (!spf[j]) spf[j] = i;
      let sum = 0, first = null;
      const vals = [];
      for (let n = 1; n <= max; n++) {
        let x = n, omega = 0;
        while (x > 1) { const q = spf[x]; x /= q; omega++; }
        sum += omega % 2 ? -1 : 1;
        if (n <= 10) vals.push(`λ(${n})=${omega % 2 ? -1 : 1}`);
        if (first === null && n >= 2 && sum > 0) first = n;
      }
      return [...vals, `前缀和 L(${max}) = ${sum}`, first === null ? `≤${max} 未发现正前缀和` : `首个正前缀和出现在 n=${first}`].join("\n");
    }),

  R("tournament", MATH, "单败淘汰赛树（Arbre de Tournoi）", "输入每行一个选手；生成单败淘汰轮次与轮空",
    [], (t) => {
      let players = tokensOf(String(t).replace(/[\r\n]+/g, ","));
      if (players.length < 2 || players.length > 128) throw new Error("选手数需为 2..128");
      const out = [];
      let round = 0;
      while (players.length > 1) {
        round++;
        let size = 1;
        while (size < players.length) size *= 2;
        const byes = size - players.length;
        const next = [];
        const matches = [];
        for (let i = 0; i < byes; i++) next.push(players[i]);
        for (let i = byes; i < players.length; i += 2) {
          const a = players[i], b = players[i + 1];
          matches.push(`${a} vs ${b}`);
          next.push(`${a}/${b}`);
        }
        out.push(`第 ${round} 轮: ${matches.join(", ") || "(轮空)"}${byes ? `；轮空: ${players.slice(0, byes).join(", ")}` : ""}`);
        if (matches.length === 0) break;
        players = next;
      }
      return out.join("\n");
    }),

  R("round-robin", MATH, "循环赛程（Générateur de Championnat）", "圆桌轮转法生成单循环赛程；奇数人数自动轮空",
    [], (t) => {
      let players = tokensOf(String(t).replace(/[\r\n]+/g, ","));
      if (players.length < 2 || players.length > 128) throw new Error("选手数需为 2..128");
      if (players.length % 2) players = [...players, "BYE"];
      const n = players.length, rounds = n - 1, half = n / 2;
      const arr = players.slice();
      const out = [];
      for (let r = 0; r < rounds; r++) {
        const ms = [];
        for (let i = 0; i < half; i++) {
          const a = arr[i], b = arr[n - 1 - i];
          if (a !== "BYE" && b !== "BYE") ms.push(`${a} vs ${b}`);
        }
        out.push(`第 ${r + 1} 轮: ${ms.join(", ")}`);
        const fixed = arr[0], rest = arr.slice(1);
        rest.unshift(rest.pop());
        arr.splice(0, arr.length, fixed, ...rest);
      }
      return out.join("\n");
    }),

  R("americano", MATH, "Americano 轮转（Générateur de Tournoi Americano）", "4 人一组，3 轮搭档轮转（1-2 vs 3-4、1-3 vs 2-4、1-4 vs 2-3）；多人时按连续 4 人分组",
    [], (t) => {
      const players = tokensOf(String(t).replace(/[\r\n]+/g, ","));
      if (players.length < 4 || players.length % 4 || players.length > 256) throw new Error("人数需为 4 的倍数且 ≤256");
      const out = [];
      for (let g = 0; g < players.length; g += 4) {
        const [a, b, c, d] = players.slice(g, g + 4);
        out.push(`组 ${g / 4 + 1}:`);
        out.push(`  第1轮: ${a}+${b} vs ${c}+${d}`);
        out.push(`  第2轮: ${a}+${c} vs ${b}+${d}`);
        out.push(`  第3轮: ${a}+${d} vs ${b}+${c}`);
      }
      return out.join("\n");
    }),

  R("life", MATH, "生命游戏（Jeu de la Vie）", "Conway 生命游戏；输入 #/./0/1 网格，输出指定代数后的网格",
    [P("gens", "代数", "1")],
    (t, p) => {
      const rows = linesOf(t).filter((l) => l.trim());
      if (!rows.length || rows.some((r) => r.replace(/[#.01 ]/g, ""))) throw new Error("网格只能包含 # . 0 1 和空格");
      const h = rows.length, w = Math.max(...rows.map((r) => r.length));
      if (h * w > 1e6) throw new Error("网格上限 1000000 格");
      let g = rows.map((r) => [...r.padEnd(w, ".")].map((c) => c === "#" || c === "1" ? 1 : 0));
      const gens = INT((p && p.gens) || "1", 0, 1000, "代数");
      for (let s = 0; s < gens; s++) {
        const n = g.map((r) => r.slice());
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
          let k = 0;
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            const yy = (y + dy + h) % h, xx = (x + dx + w) % w;
            k += g[yy][xx];
          }
          n[y][x] = g[y][x] ? (k === 2 || k === 3 ? 1 : 0) : (k === 3 ? 1 : 0);
        }
        g = n;
      }
      return g.map((r) => r.map((x) => x ? "#" : ".").join("")).join("\n");
    }),

  R("syllogism", MATH, "三段论有效性（Syllogismes）", "输入三行（大前提/小前提/结论），识别 A/E/I/O 与格，校验 24 个有效 mood；支持 All/No/Some … are … 与法语 Tous/Aucun/Certains",
    [], (t) => {
      const ls = linesOf(t).map((x) => x.trim()).filter(Boolean);
      if (ls.length !== 3) throw new Error("需要三行：大前提、小前提、结论");
      const parse = (s) => {
        const x = stripAccents(s).replace(/^(therefore|donc|so|thus|结论[:：]?)\s*/i, "").replace(/[.!。]+$/, "").trim();
        let m = x.match(/^(all|tous|toutes|every)\s+(\w+)\s+(?:are|is|sont|est)\s+(\w+)$/i);
        if (m) return { q: "A", s: m[2].toLowerCase(), p: m[3].toLowerCase() };
        m = x.match(/^(no|aucun|aucune)\s+(\w+)\s+(?:are|is|sont|est)\s+(\w+)$/i);
        if (m) return { q: "E", s: m[2].toLowerCase(), p: m[3].toLowerCase() };
        m = x.match(/^(some|certains|certaines)\s+(\w+)\s+(?:are|is|sont|est)\s+(\w+)$/i);
        if (m) return { q: "I", s: m[2].toLowerCase(), p: m[3].toLowerCase() };
        m = x.match(/^(some|certains|certaines)\s+(\w+)\s+(?:are|is|sont|est)\s+not\s+(\w+)$/i);
        if (m) return { q: "O", s: m[2].toLowerCase(), p: m[3].toLowerCase() };
        throw new Error(`无法解析命题「${s}」`);
      };
      const [p1, p2, c] = ls.map(parse);
      const all = [p1.s, p1.p, p2.s, p2.p, c.s, c.p];
      const mids = [...new Set(all.filter((x) => all.filter((y) => y === x).length >= 2))];
      const M = mids.find((m) => m !== c.s && m !== c.p);
      if (!M) throw new Error("找不到中项 M");
      const getFig = (major, minor) => {
        if (major.s === M && minor.p === M) return 1;
        if (major.p === M && minor.p === M) return 2;
        if (major.s === M && minor.s === M) return 3;
        if (major.p === M && minor.s === M) return 4;
        return 0;
      };
      const hasP = (x) => x.s === c.p || x.p === c.p;
      const major = hasP(p1) ? p1 : hasP(p2) ? p2 : null;
      const minor = major === p1 ? p2 : p1;
      if (!major) throw new Error("无法确定大前提（结论谓项）");
      const fig = getFig(major, minor);
      const mood = major.q + minor.q + c.q;
      const valid = {
        1: ["AAA", "EAE", "AII", "EIO", "AAI", "EAO"],
        2: ["EAE", "AEE", "EIO", "AOO", "EAO", "AEO"],
        3: ["AAI", "IAI", "AII", "EAO", "OAO", "EIO"],
        4: ["AAI", "AEE", "IAI", "EAO", "EIO", "AEO"],
      };
      return [`格: ${fig}`, `式: ${mood}-${fig}`, `中项: ${M}`, `有效性: ${valid[fig] && valid[fig].includes(mood) ? "有效" : "无效"}`].join("\n");
    }),

  R("random-sample", MATH, "随机抽样（Echantillon Aléatoire）", "从列表无放回抽取 k 项（CSPRNG）；k 超限报错",
    [P("k", "抽取数量", "3")],
    (t, p) => {
      const a = tokensOf(String(t).replace(/[\r\n]+/g, ","));
      if (!a.length) throw new Error("需要列表");
      const k = INT((p && p.k) || "3", 1, a.length, "抽取数量");
      return shuffled(a).slice(0, k).join("\n");
    }),

  R("random-digits", MATH, "随机数字串（Chiffres Aléatoires）", "生成指定长度 CSPRNG 随机十进制数字串",
    [P("n", "位数", "16")],
    (t, p) => {
      const n = INT((p && p.n) || String(t || "16"), 1, 100000, "位数");
      let out = "";
      for (let i = 0; i < n; i++) out += randInt(10);
      return out;
    }),

  R("draw", MATH, "随机抽取（Tirage au Sort）", "从列表等概率抽取一项（CSPRNG）",
    [], (t) => {
      const a = tokensOf(String(t).replace(/[\r\n]+/g, ","));
      if (!a.length) throw new Error("需要列表");
      return a[randInt(a.length)];
    }),

  R("insee", NUM, "INSEE 市镇代码（Code Commune INSEE）", "校验 5 位法国市镇代码（含 2A/2B 科西嘉），输出省代码",
    [], (t) => {
      const s = String(t).trim().toUpperCase();
      if (!/^(\d{5}|2[AB]\d{3})$/.test(s)) throw new Error("INSEE 代码需为 5 位（科西嘉 2A/2B）");
      const dept = s.slice(0, 2);
      return `代码: ${s}\n省: ${dept}\n格式: 有效`;
    }),

  R("parsons", NUM, "Parsons 旋律轮廓码", "输入音名序列，输出 Parsons code（* 起始，U/D/R 表示上行/下行/重复）",
    [], (t) => {
      const notes = tokensOf(String(t).replace(/[\r\n]+/g, ","));
      if (!notes.length) throw new Error("需要音名序列");
      const rank = (x) => {
        const m = x.match(/^([A-Ga-g])([#b♯♭]?)(-?\d+)?$/);
        if (!m) throw new Error(`无法识别音名「${x}」`);
        const base = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1].toUpperCase()];
        const alt = m[2] === "#" || m[2] === "♯" ? 1 : m[2] === "b" || m[2] === "♭" ? -1 : 0;
        return base + alt + (m[3] ? Number(m[3]) * 12 : 0);
      };
      const v = notes.map(rank);
      let out = "*";
      for (let i = 1; i < v.length; i++) out += v[i] > v[i - 1] ? "U" : v[i] < v[i - 1] ? "D" : "R";
      return out;
    }),

  R("postal-fr", NUM, "法国邮政编码（Code Postal）", "校验 5 位法国邮编并输出省/海外领地代码；不查询具体市镇",
    [], (t) => {
      const s = String(t).trim();
      if (!/^\d{5}$/.test(s)) throw new Error("法国邮编需为 5 位数字");
      const dept = s.slice(0, 2);
      const oversea = dept === "97" || dept === "98";
      return [`邮编: ${s}`, `省/领地代码: ${s.slice(0, oversea ? 3 : 2)}`, `类型: ${oversea ? "海外省/领地" : dept === "20" ? "科西嘉" : "本土"}`].join("\n");
    }),

  R("codons", NUM, "遗传密码子（Codons / Code Génétique）", "DNA 三联体 → 氨基酸（1/3 字母）或终止符；支持 T/U 与按空格/连字符分段",
    [], (t) => {
      const s = String(t).toUpperCase().replace(/U/g, "T").replace(/[^ACGT]/g, "");
      if (!s || s.length % 3) throw new Error("需要 3 的倍数的 ACGT 序列");
      const out = [];
      for (let i = 0; i < s.length; i += 3) {
        const c = s.slice(i, i + 3);
        const a = CODON[c];
        if (!a) throw new Error(`未知密码子 ${c}`);
        out.push(`${c} → ${a[0]} (${a[1]})`);
      }
      return out.join("\n");
    }),

  R("electron-config", NUM, "电子排布（Configuration Electronique）", "按 Aufbau 原理填充 1..118 号元素，输出全排布与稀有气体简写；含常见例外",
    [], (t) => {
      const z = INT(String(t).trim(), 1, 118, "原子序数");
      const cfg = electronConfig(z);
      return `Z=${z} ${ELEMENTS[z - 1][0]} (${ELEMENTS[z - 1][1]})\n全排布: ${cfg.full}\n简写: ${cfg.short}`;
    }),

  R("bounds", NUM, "数值夹逼（Encadrement d'un Nombre）", "输出 floor/ceil 与不等式夹逼；支持小数与负数",
    [], (t) => {
      const x = Number(String(t).trim());
      if (!Number.isFinite(x)) throw new Error("需要数字");
      const lo = Math.floor(x), hi = Math.ceil(x);
      return `${lo} ≤ ${x} ≤ ${hi}${lo === hi ? "（整数）" : ""}`;
    }),

  R("number-sets", NUM, "数集判定（Ensembles de Nombres）", "判定输入属于 N/Z/D/Q/R/C 哪些集合；支持整数、小数、分数、√n、i 与 a+bi",
    [], (t) => {
      const s = String(t).trim().replace(/\s+/g, "").replace(/√/g, "sqrt");
      if (!s) throw new Error("需要数字表达式");
      const sets = [];
      let isInt = false, isRat = false, isReal = true, isComplex = false;
      if (/^-?\d+$/.test(s)) { isInt = true; isRat = true; }
      else if (/^-?\d*\.\d+$/.test(s)) { isRat = true; }
      else if (/^-?\d+\/-?\d+$/.test(s)) { isRat = true; }
      else if (/^sqrt\(?\d+\)?$/.test(s)) { isReal = true; }
      else if (/^(i|j|-?i|-?j)$/.test(s)) { isComplex = true; isReal = false; }
      else if (/^-?\d*\.?\d*[+-]\d*\.?\d*[ij]$/.test(s)) { isComplex = true; isReal = false; }
      else throw new Error("无法识别的数形式");
      const n = isInt ? Number(s) : null;
      if (isInt && n >= 0) sets.push("N");
      if (isInt) sets.push("Z");
      if (isRat) sets.push("D", "Q");
      if (isReal) sets.push("R");
      if (isComplex || isReal) sets.push("C");
      return `数: ${s}\n所属数集: ${sets.join(", ")}`;
    }),

  R("knuth", NUM, "Knuth 上箭头（Flèches de Knuth）", "计算 a ↑…↑ b（1..4 个箭头）；BigInt 有界，过大报错",
    [P("a", "底数 a", "2"), P("b", "指数 b / 高度", "3"), P("arrows", "箭头数", "2")],
    (t, p) => {
      const a = BigInt(INT((p && p.a) || String(t || "2"), 0, 1e6, "a"));
      const b = BigInt(INT((p && p.b) || "3", 0, 1e6, "b"));
      const arrows = INT((p && p.arrows) || "2", 1, 4, "箭头数");
      const LIMIT = 10n ** 3000n;
      const arrow = (x, y, k) => {
        if (k === 1) {
          let r = 1n;
          for (let i = 0n; i < y; i++) { r *= x; if (r > LIMIT) throw new Error("结果超过 10^3000，拒绝计算"); }
          return r;
        }
        if (y === 0n) return 1n;
        let r = x;
        for (let i = 1n; i < y; i++) { r = arrow(x, r, k - 1); if (r > LIMIT) throw new Error("结果超过 10^3000，拒绝计算"); }
        return r;
      };
      const v = arrow(a, b, arrows);
      return `${a} ${"↑".repeat(arrows)} ${b} = ${v}`;
    }),

  R("san", NUM, "国际象棋代数记谱（Notation SAN）", "解析 SAN 走法（O-O/O-O-O、棋子、吃子、升变、将军）并给出标准坐标形式；不校验局面合法性",
    [], (t) => {
      const s = String(t).trim();
      if (!/^(O-O(-O)?|[KQRBN]?[a-h]?[1-8]?x?[a-h][1-8](=[QRBN])?[+#]?)$/.test(s)) throw new Error("SAN 格式无效");
      if (s.startsWith("O-O")) return `王车易位: ${s === "O-O" ? "短易位 (e1-g1)" : "长易位 (e1-c1)"}`;
      const m = s.match(/^([KQRBN])?([a-h])?([1-8])?(x)?([a-h][1-8])(=[QRBN])?([+#])?$/);
      if (!m) throw new Error("SAN 解析失败");
      const piece = m[1] || "P";
      const to = m[5];
      const from = m[2] || m[3] || "?";
      return [`棋子: ${piece}`, `起点约束: ${from}`, `目标: ${to}`, `吃子: ${m[4] ? "是" : "否"}`, `升变: ${m[6] ? m[6].slice(1) : "无"}`, `将军: ${m[7] || "无"}`, `坐标形式: ${piece === "P" ? "" : piece}${m[2] || ""}${m[3] || ""}${m[4] ? "x" : ""}${to}`].join("\n");
    }),

  R("uci", NUM, "UCI 走法坐标（Notation Echecs UCI）", "UCI 坐标 ↔ 代数方格；支持 e2e4、e7e8q、0000",
    [SEL("mode", "方向", "parse", [{ value: "parse", label: "UCI → 方格" }, { value: "build", label: "方格 → UCI" }])],
    (t, p) => {
      const mode = String((p && p.mode) || "parse");
      if (mode === "build") {
        const a = String(t).trim().split(/[\s,;-]+/);
        if (a.length < 2) throw new Error("需要 from,to[,promo]");
        const sq = (x) => { if (!/^[a-h][1-8]$/.test(x)) throw new Error(`无效方格 ${x}`); return x; };
        return sq(a[0]) + sq(a[1]) + (a[2] ? a[2].toLowerCase() : "");
      }
      const s = String(t).trim().toLowerCase();
      if (s === "0000") return "空着 (null move)";
      const m = s.match(/^([a-h][1-8])([a-h][1-8])([qrbn])?$/);
      if (!m) throw new Error("UCI 走法无效");
      return `起点: ${m[1]}\n终点: ${m[2]}\n升变: ${m[3] ? m[3].toUpperCase() : "无"}`;
    }),

  R("fen", NUM, "FEN 局面（Notation Forsyth-Edwards）", "解析 FEN 前 6 段，输出 ASCII 棋盘并校验 8 行与每行 8 格",
    [], (t) => {
      const parts = String(t).trim().split(/\s+/);
      if (parts.length < 4) throw new Error("FEN 至少需要 4 段");
      const rows = parts[0].split("/");
      if (rows.length !== 8) throw new Error("FEN 棋盘必须为 8 行");
      const board = rows.map((r) => {
        let out = "";
        for (const ch of r) {
          if (/\d/.test(ch)) out += ".".repeat(Number(ch));
          else if (/[prnbqkPRNBQK]/.test(ch)) out += ch;
          else throw new Error(`FEN 中出现非法字符「${ch}」`);
        }
        if (out.length !== 8) throw new Error(`FEN 某行格数为 ${out.length}，应为 8`);
        return out;
      });
      const pieces = board.join("").replace(/\./g, "").length;
      return [`轮到: ${parts[1] === "w" ? "白" : parts[1] === "b" ? "黑" : "?"}`, `易位: ${parts[2]}`, `吃过路兵: ${parts[3]}`, `棋子数: ${pieces}`, ...board].join("\n");
    }),

  R("rpn", NUM, "逆波兰表达式（Notation Polonaise Inverse）", "RPN 计算器：支持 + - * / ^ 与整数/小数；栈式求值",
    [], (t) => {
      const toks = String(t).trim().split(/\s+/).filter(Boolean);
      if (!toks.length) throw new Error("需要 RPN 表达式");
      const st = [];
      for (const tok of toks) {
        if (/^[-+]?\d*\.?\d+$/.test(tok)) { st.push(Number(tok)); continue; }
        if (!["+", "-", "*", "/", "^"].includes(tok)) throw new Error(`未知 token「${tok}」`);
        if (st.length < 2) throw new Error("栈不足");
        const b = st.pop(), a = st.pop();
        let v;
        if (tok === "+") v = a + b;
        else if (tok === "-") v = a - b;
        else if (tok === "*") v = a * b;
        else if (tok === "/") { if (b === 0) throw new Error("除以 0"); v = a / b; }
        else v = a ** b;
        st.push(v);
      }
      if (st.length !== 1) throw new Error("表达式未归约为单值");
      return String(st[0]);
    }),

  R("chords", NUM, "和弦构成音（Notation des Accords）", "和弦名 → 根音与构成音（大/小/7/ maj7/m7/dim/aug/sus）；不生成指板图",
    [], (t) => {
      const s = String(t).trim();
      const m = s.match(/^([A-Ga-g])([#b♯♭]?)(maj7|m7|dim|aug|sus2|sus4|maj|m|7|6|m6|add9|9)?$/);
      if (!m) throw new Error("无法识别和弦名");
      const root = m[1].toUpperCase() + (m[2] === "♯" ? "#" : m[2] === "♭" ? "b" : m[2] || "");
      const q = (m[3] || "maj").toLowerCase();
      const iv = { maj: [0, 4, 7], m: [0, 3, 7], "7": [0, 4, 7, 10], maj7: [0, 4, 7, 11], m7: [0, 3, 7, 10], dim: [0, 3, 6], aug: [0, 4, 8], sus2: [0, 2, 7], sus4: [0, 5, 7], "6": [0, 4, 7, 9], m6: [0, 3, 7, 9], add9: [0, 4, 7, 14], "9": [0, 4, 7, 10, 14] };
      const base = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
      const map = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
      let r = map[root[0]];
      if (root[1] === "#") r++; else if (root[1] === "b") r--;
      const notes = (iv[q] || iv.maj).map((x) => base[((r + x) % 12 + 12) % 12]);
      return `和弦: ${s}\n根音: ${root}\n性质: ${q}\n构成音: ${notes.join(" ")}`;
    }),

  R("atomic-number", NUM, "原子序数 / 元素符号（Numéro Atomique）", "元素符号、英文名或原子序数互查（1..118）；输出符号、名称、序数",
    [], (t) => {
      const s = String(t).trim();
      const idx = (q) => ELEMENTS.findIndex(([sym, name]) => sym.toLowerCase() === q.toLowerCase() || name.toLowerCase() === q.toLowerCase());
      const found = /^\d+$/.test(s) ? (Number(s) >= 1 && Number(s) <= 118 ? Number(s) - 1 : -1) : idx(s);
      if (found < 0) throw new Error("未知元素");
      return `符号: ${ELEMENTS[found][0]}\n名称: ${ELEMENTS[found][1]}\n原子序数: ${found + 1}`;
    }),

  R("barcode-country", NUM, "条码国家/地区（Pays des Code-Barres）", "按 EAN/GS1 前缀 3 位判断国家或地区；范围表不覆盖全部历史分配",
    [], (t) => {
      const s = String(t).replace(/\D/g, "");
      if (s.length < 3) throw new Error("需要至少 3 位数字前缀");
      const p = Number(s.slice(0, 3));
      for (const [lo, hi, name] of GS1_COUNTRY) if (p >= lo && p <= hi) return `前缀: ${String(p).padStart(3, "0")}\n国家/地区: ${name}`;
      return `前缀: ${String(p).padStart(3, "0")}\n国家/地区: 未收录（可能是内部/受限前缀）`;
    }),

  R("digit-rank", NUM, "数字位次（Rang dans un Nombre）", "找出指定数字在数中的所有位次（左起/右起）与位权",
    [P("digit", "要找的数字", "2")],
    (t, p) => {
      const s = String(t).trim();
      const d = String((p && p.digit) || "2");
      if (!/^-?\d+$/.test(s) || !/^\d$/.test(d)) throw new Error("需要整数与单个数字");
      const body = s.replace(/^-/, "");
      const out = [];
      for (let i = 0; i < body.length; i++) if (body[i] === d) {
        const fromRight = body.length - i;
        out.push(`左起第 ${i + 1} 位 / 右起第 ${fromRight} 位 / 位权 ${10n ** BigInt(fromRight - 1)}`);
      }
      return out.length ? out.join("\n") : `数字 ${d} 未出现`;
    }),

  R("boolean", MATH, "布尔表达式 / 真值表 / 对偶", "支持 & | ! ^、AND/OR/NOT/XOR、0/1、true/false；mode=eval|truth|dual；变量最多 6 个",
    [SEL("mode", "模式", "eval", [{ value: "eval", label: "求值（需变量赋值）" }, { value: "truth", label: "真值表" }, { value: "dual", label: "对偶式" }]), P("env", "赋值", "A=1,B=0,C=1")],
    (t, p) => {
      const mode = String((p && p.mode) || "eval");
      const src = String(t);
      if (mode === "dual") return boolDual(src);
      const vars = boolVars(src);
      if (vars.length > 6) throw new Error("变量最多 6 个");
      if (mode === "eval") {
        const env = {};
        for (const pair of String((p && p.env) || "").split(/[,;]+/).filter(Boolean)) {
          const [k, v] = pair.split("=");
          if (!k || !/^[01]$/.test(String(v).trim())) throw new Error(`赋值「${pair}」无效`);
          env[k.trim()] = Number(v);
        }
        for (const v of vars) if (!(v in env)) throw new Error(`缺少变量 ${v} 的赋值`);
        return `${src.trim()} = ${boolEval(src, env) ? 1 : 0}`;
      }
      const rows = [];
      for (let m = 0; m < 2 ** vars.length; m++) {
        const env = {};
        vars.forEach((v, i) => { env[v] = (m >> (vars.length - 1 - i)) & 1; });
        rows.push([...vars.map((v) => env[v]), boolEval(src, env) ? 1 : 0]);
      }
      return [vars.join(" ") + " | F", ...rows.map((r) => r.slice(0, -1).join(" ") + " | " + r[r.length - 1])].join("\n");
    }),

  R("minterms", MATH, "最小项 / 最大项（MinTermes et MaxTermes）", "由布尔表达式枚举真值表，输出 Σm 最小项与 ΠM 最大项",
    [], (t) => {
      const vars = boolVars(t);
      if (!vars.length || vars.length > 8) throw new Error("变量数需为 1..8");
      const min = [], max = [];
      for (let m = 0; m < 2 ** vars.length; m++) {
        const env = {};
        vars.forEach((v, i) => { env[v] = (m >> (vars.length - 1 - i)) & 1; });
        (boolEval(t, env) ? min : max).push(m);
      }
      return `变量: ${vars.join("")}\nΣm: ${min.join(",") || "∅"}\nΠM: ${max.join(",") || "∅"}`;
    }),

  R("kmap", MATH, "卡诺图化简（Table de Karnaugh）", "Quine–McCluskey 化简 1..4 变量布尔表达式，输出最小覆盖的积之和",
    [], (t) => {
      const vars = boolVars(t);
      if (!vars.length || vars.length > 4) throw new Error("K-map 仅支持 1..4 变量");
      const min = [];
      for (let m = 0; m < 2 ** vars.length; m++) {
        const env = {};
        vars.forEach((v, i) => { env[v] = (m >> (vars.length - 1 - i)) & 1; });
        if (boolEval(t, env)) min.push(m);
      }
      if (!min.length) return "0";
      return qmMinimize(min, vars);
    }),

  R("resistor", MATH, "电阻色环（Code Couleur des Résistances）", "4/5 环色名 → 阻值与误差；输入纯数字时按 4 环反推色环",
    [P("bands", "色环", "brown black red gold")],
    (t, p) => {
      const raw = String((p && p.bands) || t || "").trim().toLowerCase();
      if (/^[\d.]+$/.test(raw)) return resistorFromValue(Number(raw), 4);
      const bands = raw.split(/[\s,;]+/).filter(Boolean);
      if (![4, 5].includes(bands.length)) throw new Error("需要 4 或 5 个色环");
      const d = bands.slice(0, bands.length - 2).map((b) => RES_COLORS[b]);
      if (d.some((x) => x === undefined)) throw new Error("有效数字色环无效");
      const mult = bands[bands.length - 2], tol = bands[bands.length - 1];
      const multExp = RES_MULT[mult];
      if (multExp === undefined) throw new Error("倍率色环无效");
      if (RES_TOL[tol] === undefined && tol !== "none") throw new Error("误差色环无效");
      let v = 0;
      for (const x of d) v = v * 10 + x;
      v *= 10 ** multExp;
      const tolV = RES_TOL[tol] === undefined ? 20 : RES_TOL[tol];
      return `色环: ${bands.join(" ")}\n阻值: ${kb(v)}Ω (${v} Ω)\n误差: ±${tolV}%`;
    }),

  R("capacitor", MATH, "电容色环 / 数码（Code Couleur des Condensateurs）", "三位电容码 → pF/nF/µF；可带误差字母 J/K/M",
    [], (t) => {
      const s = String(t).trim().toUpperCase();
      const m = s.match(/^(\d{2})(\d)([JKMZ])?$/);
      if (!m) throw new Error("电容码需为 3 位数字 + 可选误差字母");
      const pf = Number(m[1]) * 10 ** Number(m[2]);
      const tol = { J: 5, K: 10, M: 20, Z: 80 }[m[3]] || null;
      return `码: ${s}\n容量: ${pf} pF = ${pf / 1000} nF = ${pf / 1e6} µF${tol ? `\n误差: ±${tol}%` : ""}`;
    }),

  R("rib", MATH, "法国 RIB 校验（Numéro de Compte RIB）", "输入 banque guichet compte [clé]；字母按 A=1..I=9,J=1..R=9,S=2..Z=9 转换，计算 97 校验键",
    [], (t) => {
      const a = String(t).trim().split(/\s+/).filter(Boolean);
      if (a.length < 3 || a.length > 4) throw new Error("需要 banque guichet compte [clé]");
      const conv = (s) => [...s.toUpperCase()].map((c) => {
        if (/\d/.test(c)) return c;
        const code = c.charCodeAt(0) - 64;
        if (code >= 1 && code <= 9) return String(code);
        if (code >= 10 && code <= 18) return String(code - 9);
        if (code >= 19 && code <= 26) return String(code - 17);
        throw new Error(`RIB 中出现非法字符「${c}」`);
      }).join("");
      const [b, g, c] = a.slice(0, 3).map(conv);
      if (b.length !== 5 || g.length !== 5 || c.length !== 11) throw new Error("banque/guichet 需 5 位，compte 需 11 位");
      const key = 97 - ((89 * Number(b) + 15 * Number(g) + 3 * Number(c)) % 97);
      if (a[3] !== undefined) {
        if (!/^\d{2}$/.test(a[3])) throw new Error("校验键需 2 位数字");
        return `校验键: ${a[3]}\n计算键: ${String(key).padStart(2, "0")}\n结果: ${Number(a[3]) === key ? "有效" : "无效"}`;
      }
      return `banque: ${b}\nguichet: ${g}\ncompte: ${c}\n校验键: ${String(key).padStart(2, "0")}\n完整 RIB: ${b}${g}${c}${String(key).padStart(2, "0")}`;
    }),

  R("diffie-hellman", CIPHER, "Diffie–Hellman 密钥交换（Echange de Clés）", "由公开参数 p,g 与双方私钥 a,b 计算公钥 A,B 与共享密钥；小指数仅用于演示",
    [P("p", "素数 p", "23"), P("g", "生成元 g", "5"), P("a", "私钥 a", "6"), P("b", "私钥 b", "15")],
    (t, p) => {
      const pp = B((p && p.p) || "23"), gg = B((p && p.g) || "5"), aa = B((p && p.a) || "6"), bb = B((p && p.b) || "15");
      if (pp <= 2n || gg <= 1n || aa <= 0n || bb <= 0n) throw new Error("参数需满足 p>2, g>1, a,b>0");
      const A = powmodBig(gg, aa, pp), Bp = powmodBig(gg, bb, pp), sA = powmodBig(Bp, aa, pp), sB = powmodBig(A, bb, pp);
      if (sA !== sB) throw new Error("共享密钥不一致，检查参数");
      return `p=${pp} g=${gg}\nA = g^a mod p = ${A}\nB = g^b mod p = ${Bp}\n共享密钥 = ${sA}`;
    }),
  R("cipher-identify", CIPHER, "密码识别（Reconnaitre un Chiffrement）", "按字符集与结构给出候选：Morse/二进制/十六进制/Base64/Base32/Base58/URL/HTML 实体/Unicode 转义/DNA/盲文/ADFGX/培根/波利比奥斯/ASCII 十进制/ROT13",
    [], (t) => {
      const s = String(t).trim();
      if (!s) throw new Error("需要待识别文本");
      const cands = [];
      const add = (name, score, note) => cands.push({ name, score, note });
      if (/^[.\-\s/|]+$/.test(s) && /[.\-]/.test(s)) add("Morse", 0.95, "仅含 . - / 空格");
      if (/^[01\s]+$/.test(s) && /[01]/.test(s)) add("Binary", 0.9, "仅含 0/1");
      if (/^[0-9a-fA-F\s]+$/.test(s) && s.replace(/\s/g, "").length % 2 === 0 && /[a-fA-F]/.test(s)) add("Hex", 0.8, "十六进制字符且长度为偶数");
      if (/^[A-Z2-7=\s]+$/.test(s) && /[A-Z]/.test(s) && s.replace(/\s/g, "").length >= 8) add("Base32", 0.7, "RFC 4648 Base32 字母表");
      if (/^[A-Za-z0-9+/=\s]+$/.test(s) && s.replace(/\s/g, "").length % 4 === 0 && /[+/=]/.test(s)) add("Base64", 0.75, "Base64 字母表与长度");
      if (/^[1-9A-HJ-NP-Za-km-z]+$/.test(s) && !/[0OIl]/.test(s) && s.length >= 8) add("Base58", 0.6, "Base58 字母表");
      if (/%[0-9a-fA-F]{2}/.test(s)) add("URL encoding", 0.85, "含 %XX");
      if (/&(#\d+|#x[0-9a-f]+|[a-z]+);/i.test(s)) add("HTML entities", 0.8, "含 &...; 实体");
      if (/\\u[0-9a-fA-F]{4}/.test(s)) add("Unicode escape", 0.85, "含 \\uXXXX");
      if (/^[ACGTU\s]+$/i.test(s) && /[ACGTU]/i.test(s)) add("DNA/RNA", 0.8, "仅含 ACGTU");
      if (/[\u2800-\u28ff]/.test(s)) add("Braille", 0.85, "含盲文点阵字符");
      if (/^[ADFGX\s]+$/i.test(s) && /[ADFGX]/i.test(s)) add("ADFGX", 0.75, "仅含 ADFGX");
      if (/^[ADFGVX\s]+$/i.test(s) && /[ADFGVX]/i.test(s)) add("ADFGVX", 0.75, "仅含 ADFGVX");
      if (/^[AB\s]+$/i.test(s) && s.replace(/\s/g, "").length % 5 === 0) add("Bacon", 0.7, "仅含 A/B 且长度为 5 的倍数");
      if (/^[1-5\s]+$/.test(s) && s.replace(/\s/g, "").length % 2 === 0) add("Polybius", 0.65, "仅含 1-5 且长度为偶数");
      if (/^\d{2,3}(\s*[,;]\s*\d{2,3})+$/.test(s) && s.split(/[,;]/).every((x) => Number(x.trim()) >= 32 && Number(x.trim()) <= 126)) add("ASCII decimal", 0.7, "十进制 ASCII 码");
      if (/^[A-Za-z\s]+$/.test(s)) {
        const rot = s.replace(/[a-zA-Z]/g, (c) => String.fromCharCode(c <= "Z" ? ((c.charCodeAt(0) - 65 + 13) % 26) + 65 : ((c.charCodeAt(0) - 97 + 13) % 26) + 97));
        const score = (x) => (x.toLowerCase().match(/\b(the|and|is|of|to|in|a)\b/g) || []).length;
        if (score(rot) > score(s)) add("ROT13 / Caesar", 0.6, "ROT13 后常见词增加");
      }
      if (!cands.length) add("未知/需更多样本", 0.1, "未命中内置特征");
      cands.sort((a, b) => b.score - a.score);
      return cands.map((x) => `${x.name} (${Math.round(x.score * 100)}%) — ${x.note}`).join("\n");
    }),

  C("caesar-box", CIPHER, "凯撒方阵（Chiffre Carré de César）", "按 size×size 方阵行写列读；decode 列写行读；不足格跳过",
    [P("size", "方阵边长", "3")], (t, p) => {
      const size = INT((p && p.size) || "3", 2, 100, "方阵边长");
      const s = String(t);
      const rows = Math.ceil(s.length / size);
      const grid = Array.from({ length: rows }, () => new Array(size).fill(null));
      for (let i = 0; i < s.length; i++) grid[Math.floor(i / size)][i % size] = s[i];
      let out = "";
      for (let c = 0; c < size; c++) for (let r = 0; r < rows; r++) if (grid[r][c] !== null) out += grid[r][c];
      return out;
    }, (t, p) => {
      const size = INT((p && p.size) || "3", 2, 100, "方阵边长");
      const s = String(t);
      const rows = Math.ceil(s.length / size);
      const grid = Array.from({ length: rows }, () => new Array(size).fill(null));
      let idx = 0;
      for (let c = 0; c < size; c++) for (let r = 0; r < rows; r++) if (r * size + c < s.length) grid[r][c] = s[idx++];
      let out = "";
      for (let r = 0; r < rows; r++) for (let c = 0; c < size; c++) if (grid[r][c] !== null) out += grid[r][c];
      return out;
    }),

  C("ubchi", CIPHER, "Ubchi 双换位（Chiffre Ubchi）", "同一关键词做两次列换位；encode/decode 互逆",
    [P("key", "关键词", "SECRET")], (t, p) => columnarTwice(String(t), String((p && p.key) || "SECRET"), true), (t, p) => columnarTwice(String(t), String((p && p.key) || "SECRET"), false)),

  C("spiral", CIPHER, "螺旋方阵（Chiffre par Ecriture Spirale）", "按顺时针由外向内的螺旋顺序写入方阵，再按行读出；decode 反向",
    [], (t) => spiralEncode(String(t)), (t) => spiralDecode(String(t))),

  R("transposition-key", CIPHER, "换位关键词（Clé de Transposition）", "关键词 → 字母序排名（同字母按出现顺序），再按排名输出列序",
    [], (t) => {
      const key = String(t).toUpperCase().replace(/[^A-Z]/g, "");
      if (key.length < 2) throw new Error("关键词需至少 2 个字母");
      const sorted = [...key].map((c, i) => [c, i]).sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] - b[1]);
      const rank = new Array(key.length);
      sorted.forEach(([, i], r) => { rank[i] = r + 1; });
      return `关键词: ${key}\n列序: ${rank.join(" ")}\n按列读取顺序: ${[...rank.keys()].sort((a, b) => rank[a] - rank[b]).join(" ")}`;
    }),

  C("route-path", CIPHER, "路径读写（Ecriture Chemin）", "把文本按 width 排成网格，按 rows/cols/snake/spiral 路径读取；decode 反向写回",
    [P("width", "每行宽度", "5"), SEL("path", "路径", "rows", ["rows", "cols", "snake", "spiral"])], (t, p) => {
      const width = INT((p && p.width) || "5", 1, 500, "宽度");
      const path = String((p && p.path) || "rows");
      const s = String(t);
      const rows = Math.ceil(s.length / width);
      const g = Array.from({ length: rows }, (_, r) => s.slice(r * width, (r + 1) * width));
      if (path === "rows") return g.join("");
      if (path === "cols") {
        let out = "";
        for (let c = 0; c < width; c++) for (let r = 0; r < rows; r++) if (c < g[r].length) out += g[r][c];
        return out;
      }
      if (path === "snake") return g.map((row, r) => r % 2 ? [...row].reverse().join("") : row).join("");
      return spiralEncode(s);
    }, (t, p) => {
      const width = INT((p && p.width) || "5", 1, 500, "宽度");
      const path = String((p && p.path) || "rows");
      const s = String(t);
      const rows = Math.ceil(s.length / width);
      if (path === "rows") return s;
      const g = Array.from({ length: rows }, () => new Array(width).fill(""));
      if (path === "cols") {
        let idx = 0;
        for (let c = 0; c < width; c++) for (let r = 0; r < rows; r++) if (r * width + c < s.length) g[r][c] = s[idx++];
        return g.map((r) => r.join("")).join("");
      }
      if (path === "snake") {
        let idx = 0;
        for (let r = 0; r < rows; r++) {
          const order = r % 2 ? [...Array(width).keys()].reverse() : [...Array(width).keys()];
          for (const c of order) if (r * width + c < s.length) g[r][c] = s[idx++];
        }
        return g.map((r) => r.join("")).join("");
      }
      return spiralDecode(s);
    }),

  C("boustrophedon", CIPHER, "牛耕式书写（Ecriture Boustrophédon）", "逐行交替正反向（偶数行反写）；同一操作可还原",
    [], (t) => linesOf(t).map((l, i) => i % 2 ? [...l].reverse().join("") : l).join("\n"),
    (t) => linesOf(t).map((l, i) => i % 2 ? [...l].reverse().join("") : l).join("\n")),

  C("mirror-text", CIPHER, "镜像书写（Ecriture Spéculaire）", "逐行反转字符；可选把 b/d、p/q 等替换为镜像字形",
    [SEL("glyphs", "镜像字形", "non", [{ value: "non", label: "仅反转" }, { value: "oui", label: "反转并替换字形" }])], (t, p) => {
      const glyph = String((p && p.glyphs) || "non") === "oui";
      return linesOf(t).map((l) => {
        let r = [...l].reverse().join("");
        if (glyph) r = [...r].map((c) => MIRROR_GLYPH[c] || c).join("");
        return r;
      }).join("\n");
    }, (t, p) => {
      const glyph = String((p && p.glyphs) || "non") === "oui";
      return linesOf(t).map((l) => {
        let r = glyph ? [...l].map((c) => MIRROR_GLYPH_REV[c] || c).join("") : l;
        return [...r].reverse().join("");
      }).join("\n");
    }),

  C("reverse-text", CIPHER, "倒序文本（Ecriture en Sens Inverse）", "整体反转或逐行反转",
    [SEL("mode", "模式", "all", [{ value: "all", label: "整体反转" }, { value: "lines", label: "逐行反转" }])],
    (t, p) => String((p && p.mode) || "all") === "lines" ? linesOf(t).map((l) => [...l].reverse().join("")).join("\n") : [...String(t)].reverse().join(""),
    (t, p) => String((p && p.mode) || "all") === "lines" ? linesOf(t).map((l) => [...l].reverse().join("")).join("\n") : [...String(t)].reverse().join("")),

  C("upside-down", CIPHER, "倒置书写（Ecriture à l'Envers）", "使用倒置 Unicode 字形并把整行反转；decode 反向还原",
    [], (t) => [...String(t)].reverse().map((c) => UPSIDE[c] || UPSIDE[c.toLowerCase()] || c).join(""),
    (t) => [...String(t)].reverse().map((c) => UPSIDE_REV[c] || c).join("")),

  R("alphagram", CIPHER, "字母排序词（Alphagrammes）", "每个单词的字母按字典序排列，保留词序与空白",
    [], (t) => String(t).replace(/[\p{L}\p{N}]+/gu, (w) => [...w].sort((a, b) => a.localeCompare(b, "en")).join(""))),

  R("anagram", CIPHER, "异位词枚举（Générateur d'Anagrammes）", "枚举输入字母的全部不同排列；上限 5000 行，超限报错",
    [P("limit", "上限", "5000")],
    (t, p) => {
      const s = [...String(t).replace(/\s+/g, "")];
      if (!s.length || s.length > 9) throw new Error("字母数需为 1..9");
      const limit = INT((p && p.limit) || "5000", 1, 50000, "上限");
      const out = new Set();
      const walk = (prefix, rest) => {
        if (out.size > limit) throw new Error(`排列数超过上限 ${limit}`);
        if (!rest.length) { out.add(prefix); return; }
        const seen = new Set();
        for (let i = 0; i < rest.length; i++) {
          if (seen.has(rest[i])) continue;
          seen.add(rest[i]);
          walk(prefix + rest[i], rest.slice(0, i).concat(rest.slice(i + 1)));
        }
      };
      walk("", s);
      return [...out].join("\n");
    }),

  R("anacyclique", CIPHER, "回环词对（Générateur d'Anacycliques）", "在输入词表中找互为倒序的词对（如 amor/roma）",
    [], (t) => {
      const ws = tokensOf(String(t).replace(/[\r\n]+/g, ",")).map((w) => w.toLowerCase());
      const set = new Set(ws);
      const out = [];
      for (const w of ws) { const r = [...w].reverse().join(""); if (w < r && set.has(r)) out.push(`${w} ↔ ${r}`); }
      return out.length ? out.join("\n") : "未找到回环词对";
    }),

  R("palindrome-gen", CIPHER, "回文生成（Générateur de Palindromes）", "把输入补成回文：odd=中心共享末字符，even=完全镜像",
    [SEL("mode", "模式", "even", [{ value: "even", label: "偶数长度" }, { value: "odd", label: "奇数长度" }])],
    (t, p) => {
      const s = String(t);
      if (!s) throw new Error("需要文本");
      if (String((p && p.mode) || "even") === "odd") return s + [...s.slice(0, -1)].reverse().join("");
      return s + [...s].reverse().join("");
    }),

  C("javanais", CIPHER, "Javanais 黑话", "在辅音群与后续元音之间插入 av（gros → gravos）；decode 删除",
    [], (t) => String(t).replace(/([bcdfghjklmnpqrstvwxz]+)(?=[aeiouyàâäéèêëîïôöùûüœæ])/gi, "$1av"),
    (t) => String(t).replace(/([bcdfghjklmnpqrstvwxz]+)av(?=[aeiouyàâäéèêëîïôöùûüœæ])/gi, "$1")),

  C("louchebem", CIPHER, "Louchebem 黑话", "首辅音群移至词尾并加 em，前缀 l（boucher → loucherbem）；decode 反向（启发式）",
    [], (t) => wordsOf(t).map((w) => {
      const m = w.match(/^([bcdfghjklmnpqrstvwxz]+)(.*)$/i);
      return m ? "l" + m[2] + m[1] + "em" : "l" + w + "em";
    }).join(" "),
    (t) => String(t).split(/\s+/).map((w) => {
      if (!/^l.*em$/i.test(w)) return w;
      const body = w.slice(1, -2);
      const last = body.slice(-1);
      return /[bcdfghjklmnpqrstvwxz]/i.test(last) ? last + body.slice(0, -1) : body;
    }).join(" ")),

  C("pig-latin", CIPHER, "Pig Latin（英语黑话）", "元音开头加 way，辅音开头把首辅音群移到词尾加 ay；保留词序",
    [], (t) => wordsOf(t).map((w) => {
      const m = w.match(/^([bcdfghjklmnpqrstvwxz]*)(.*)$/i);
      return m && m[1] ? m[2] + m[1] + "ay" : w + "way";
    }).join(" "),
    (t) => wordsOf(t).map((w) => {
      if (/way$/i.test(w)) return w.slice(0, -3);
      if (/ay$/i.test(w)) {
        const b = w.slice(0, -2);
        const m = b.match(/([bcdfghjklmnpqrstvwxz]+)$/i);
        return m ? m[1] + b.slice(0, -m[1].length) : b;
      }
      return w;
    }).join(" ")),

  R("tarot", CIPHER, "塔罗牌（Cartes de Tarot）", "塔罗牌序号 ↔ 名称：0..21 大阿卡纳，22..77 小阿卡纳（权杖/圣杯/宝剑/星币）",
    [], (t) => {
      const s = String(t).trim();
      if (/^\d+$/.test(s)) {
        const n = Number(s);
        if (n > 77) throw new Error("塔罗序号 0..77");
        return n < 22 ? `${n} = ${TAROT_MAJOR[n]}` : `${n} = ${tarotMinor(n - 22)}`;
      }
      const idx = TAROT_MAJOR.findIndex((x) => x.toLowerCase() === s.toLowerCase());
      if (idx >= 0) return `${TAROT_MAJOR[idx]} = ${idx}`;
      throw new Error("未知塔罗牌名");
    }),

  R("playing-cards", CIPHER, "扑克牌（Cartes à Jouer）", "牌码 ↔ 0..51 索引：花色 S/H/D/C，点数 A,2..10,J,Q,K",
    [], (t) => {
      const s = String(t).trim();
      if (/^\d+$/.test(s)) {
        const n = Number(s);
        if (n > 51) throw new Error("牌索引 0..51");
        const suit = ["S", "H", "D", "C"][Math.floor(n / 13)];
        const rank = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"][n % 13];
        return `${s} = ${rank}${suit}`;
      }
      const m = s.toUpperCase().match(/^(10|[2-9JQKA])([SHDC])$/);
      if (!m) throw new Error("牌码示例：AS / 10H / KD");
      const suit = "SHDC".indexOf(m[2]);
      const rank = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"].indexOf(m[1]);
      return `${m[1]}${m[2]} = ${suit * 13 + rank}`;
    }),

  R("money", CIPHER, "货币拆分（Pièces et Billets）", "把金额按 EUR 面额贪心拆分；输出张数/枚数",
    [], (t) => {
      const raw = String(t).replace(/[^\d.,-]/g, "").replace(",", ".");
      const v = Number(raw);
      if (!Number.isFinite(v) || v < 0) throw new Error("需要非负金额");
      let cents = Math.round(v * 100);
      const out = [];
      for (const [c, name] of MONEY_EUR) {
        const n = Math.floor(cents / c);
        if (n) { out.push(`${name} × ${n}`); cents -= n * c; }
      }
      out.push(`剩余: ${(cents / 100).toFixed(2)} EUR`);
      return out.join("\n");
    }),

  R("scramble-alphabet", CIPHER, "乱序字母表（Générateur d'Alphabet Désordonné）", "用 CSPRNG 生成 A-Z 的随机排列（26 个字母各一次）",
    [], () => {
      const a = shuffled([...A26]);
      return `${a.join("")}\n小写: ${a.join("").toLowerCase()}`;
    }),
];

const MIRROR_GLYPH = { b: "d", d: "b", p: "q", q: "p", a: "ɒ", e: "ɘ", s: "ƨ", z: "ƹ", "[": "]", "]": "[", "(": ")", ")": "(", "{": "}", "}": "{" };
const MIRROR_GLYPH_REV = Object.fromEntries(Object.entries(MIRROR_GLYPH).map(([k, v]) => [v, k]));
const UPSIDE_REV = (() => {
  const m = new Map();
  for (const [k, v] of Object.entries(UPSIDE)) if (!m.has(v)) m.set(v, k);
  return Object.fromEntries(m);
})();
const TAROT_MAJOR = ["The Fool", "The Magician", "The High Priestess", "The Empress", "The Emperor", "The Hierophant", "The Lovers", "The Chariot", "Strength", "The Hermit", "Wheel of Fortune", "Justice", "The Hanged Man", "Death", "Temperance", "The Devil", "The Tower", "The Star", "The Moon", "The Sun", "Judgement", "The World"];
const TAROT_SUITS = ["Wands", "Cups", "Swords", "Pentacles"];
const TAROT_RANKS = ["Ace", "2", "3", "4", "5", "6", "7", "8", "9", "10", "Page", "Knight", "Queen", "King"];
function tarotMinor(i) {
  const suit = TAROT_SUITS[Math.floor(i / 14)], rank = TAROT_RANKS[i % 14];
  return `${rank} of ${suit}`;
}
const MONEY_EUR = [[50000, "500 EUR"], [20000, "200 EUR"], [10000, "100 EUR"], [5000, "50 EUR"], [2000, "20 EUR"], [1000, "10 EUR"], [500, "5 EUR"], [200, "2 EUR"], [100, "1 EUR"], [50, "50 cent"], [20, "20 cent"], [10, "10 cent"], [5, "5 cent"], [2, "2 cent"], [1, "1 cent"]];

function columnarEncode(text, key) {
  const s = String(text);
  const k = String(key).toUpperCase().replace(/[^A-Z]/g, "");
  if (k.length < 2) throw new Error("关键词需至少 2 个字母");
  const order = [...k].map((c, i) => [c, i]).sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] - b[1]).map(([, i]) => i);
  const rows = Math.ceil(s.length / k.length);
  let out = "";
  for (const c of order) for (let r = 0; r < rows; r++) { const i = r * k.length + c; if (i < s.length) out += s[i]; }
  return out;
}
function columnarDecode(text, key) {
  const s = String(text);
  const k = String(key).toUpperCase().replace(/[^A-Z]/g, "");
  if (k.length < 2) throw new Error("关键词需至少 2 个字母");
  const order = [...k].map((c, i) => [c, i]).sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] - b[1]).map(([, i]) => i);
  const rows = Math.ceil(s.length / k.length);
  const grid = Array.from({ length: rows }, () => new Array(k.length).fill(null));
  let idx = 0;
  for (const c of order) for (let r = 0; r < rows; r++) { const i = r * k.length + c; if (i < s.length) grid[r][c] = s[idx++]; }
  let out = "";
  for (let r = 0; r < rows; r++) for (let c = 0; c < k.length; c++) if (grid[r][c] !== null) out += grid[r][c];
  return out;
}
function columnarTwice(text, key, enc) {
  return enc ? columnarEncode(columnarEncode(text, key), key) : columnarDecode(columnarDecode(text, key), key);
}
function spiralOrder(size) {
  const out = [];
  let top = 0, bottom = size - 1, left = 0, right = size - 1;
  while (top <= bottom && left <= right) {
    for (let c = left; c <= right; c++) out.push([top, c]);
    top++;
    for (let r = top; r <= bottom; r++) out.push([r, right]);
    right--;
    if (top <= bottom) { for (let c = right; c >= left; c--) out.push([bottom, c]); bottom--; }
    if (left <= right) { for (let r = bottom; r >= top; r--) out.push([r, left]); left++; }
  }
  return out;
}
function spiralEncode(text) {
  const s = String(text);
  const size = Math.ceil(Math.sqrt(s.length));
  const g = Array.from({ length: size }, () => new Array(size).fill(null));
  const order = spiralOrder(size);
  for (let i = 0; i < s.length; i++) { const [r, c] = order[i]; g[r][c] = s[i]; }
  return g.map((r) => r.filter((x) => x !== null).join("")).join("");
}
function spiralDecode(text) {
  const s = String(text);
  const size = Math.ceil(Math.sqrt(s.length));
  const order = spiralOrder(size);
  const mask = Array.from({ length: size }, () => new Array(size).fill(false));
  for (let i = 0; i < s.length; i++) { const [r, c] = order[i]; mask[r][c] = true; }
  const g = Array.from({ length: size }, () => new Array(size).fill(null));
  let idx = 0;
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (mask[r][c]) g[r][c] = s[idx++];
  let out = "";
  for (let i = 0; i < s.length; i++) { const [r, c] = order[i]; if (g[r][c] !== null) out += g[r][c]; }
  return out;
}

function randBytes4() {
  const out = new Uint8Array(4);
  for (let i = 0; i < 4; i++) out[i] = randInt(256);
  return out;
}

const ZB32 = "ybndrfg8ejkmcpqxot1uwisza345h769";
const B37 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ ";

function base32Encode(bytes, alpha) {
  let bits = 0, value = 0, out = "";
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += alpha[(value >>> (bits - 5)) & 31];
      bits -= 5;
      value &= (1 << bits) - 1;
    }
  }
  if (bits > 0) out += alpha[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(text, alpha) {
  const s = String(text).toLowerCase().replace(/\s+/g, "").replace(/=+$/, "");
  let bits = 0, value = 0;
  const out = [];
  for (const ch of s) {
    const idx = alpha.indexOf(ch);
    if (idx < 0) throw new Error(`字符「${ch}」不在 z-base-32 字母表`);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
      value &= (1 << bits) - 1;
    }
  }
  return new Uint8Array(out);
}

const EAN_L = ["0001101", "0011001", "0010011", "0111101", "0100011", "0110001", "0101111", "0111011", "0110111", "0001011"];
const EAN_R = ["1110010", "1100110", "1101100", "1000010", "1011100", "1001110", "1010000", "1000100", "1001000", "1110100"];
const POSTNET = ["11000", "00011", "00101", "00110", "01001", "01010", "01100", "10001", "10010", "10100"];

function ean8Check(d7) {
  let sum = 0;
  for (let i = 0; i < 7; i++) sum += Number(d7[i]) * (i % 2 === 0 ? 3 : 1);
  return (10 - (sum % 10)) % 10;
}

const CODON = {
  TTT: ["F", "Phe"], TTC: ["F", "Phe"], TTA: ["L", "Leu"], TTG: ["L", "Leu"],
  TCT: ["S", "Ser"], TCC: ["S", "Ser"], TCA: ["S", "Ser"], TCG: ["S", "Ser"],
  TAT: ["Y", "Tyr"], TAC: ["Y", "Tyr"], TAA: ["*", "Stop"], TAG: ["*", "Stop"],
  TGT: ["C", "Cys"], TGC: ["C", "Cys"], TGA: ["*", "Stop"], TGG: ["W", "Trp"],
  CTT: ["L", "Leu"], CTC: ["L", "Leu"], CTA: ["L", "Leu"], CTG: ["L", "Leu"],
  CCT: ["P", "Pro"], CCC: ["P", "Pro"], CCA: ["P", "Pro"], CCG: ["P", "Pro"],
  CAT: ["H", "His"], CAC: ["H", "His"], CAA: ["Q", "Gln"], CAG: ["Q", "Gln"],
  CGT: ["R", "Arg"], CGC: ["R", "Arg"], CGA: ["R", "Arg"], CGG: ["R", "Arg"],
  ATT: ["I", "Ile"], ATC: ["I", "Ile"], ATA: ["I", "Ile"], ATG: ["M", "Met"],
  ACT: ["T", "Thr"], ACC: ["T", "Thr"], ACA: ["T", "Thr"], ACG: ["T", "Thr"],
  AAT: ["N", "Asn"], AAC: ["N", "Asn"], AAA: ["K", "Lys"], AAG: ["K", "Lys"],
  AGT: ["S", "Ser"], AGC: ["S", "Ser"], AGA: ["R", "Arg"], AGG: ["R", "Arg"],
  GTT: ["V", "Val"], GTC: ["V", "Val"], GTA: ["V", "Val"], GTG: ["V", "Val"],
  GCT: ["A", "Ala"], GCC: ["A", "Ala"], GCA: ["A", "Ala"], GCG: ["A", "Ala"],
  GAT: ["D", "Asp"], GAC: ["D", "Asp"], GAA: ["E", "Glu"], GAG: ["E", "Glu"],
  GGT: ["G", "Gly"], GGC: ["G", "Gly"], GGA: ["G", "Gly"], GGG: ["G", "Gly"],
};

const ELEMENTS = [
  ["H", "Hydrogen"], ["He", "Helium"], ["Li", "Lithium"], ["Be", "Beryllium"], ["B", "Boron"], ["C", "Carbon"], ["N", "Nitrogen"], ["O", "Oxygen"], ["F", "Fluorine"], ["Ne", "Neon"],
  ["Na", "Sodium"], ["Mg", "Magnesium"], ["Al", "Aluminium"], ["Si", "Silicon"], ["P", "Phosphorus"], ["S", "Sulfur"], ["Cl", "Chlorine"], ["Ar", "Argon"], ["K", "Potassium"], ["Ca", "Calcium"],
  ["Sc", "Scandium"], ["Ti", "Titanium"], ["V", "Vanadium"], ["Cr", "Chromium"], ["Mn", "Manganese"], ["Fe", "Iron"], ["Co", "Cobalt"], ["Ni", "Nickel"], ["Cu", "Copper"], ["Zn", "Zinc"],
  ["Ga", "Gallium"], ["Ge", "Germanium"], ["As", "Arsenic"], ["Se", "Selenium"], ["Br", "Bromine"], ["Kr", "Krypton"], ["Rb", "Rubidium"], ["Sr", "Strontium"], ["Y", "Yttrium"], ["Zr", "Zirconium"],
  ["Nb", "Niobium"], ["Mo", "Molybdenum"], ["Tc", "Technetium"], ["Ru", "Ruthenium"], ["Rh", "Rhodium"], ["Pd", "Palladium"], ["Ag", "Silver"], ["Cd", "Cadmium"], ["In", "Indium"], ["Sn", "Tin"],
  ["Sb", "Antimony"], ["Te", "Tellurium"], ["I", "Iodine"], ["Xe", "Xenon"], ["Cs", "Caesium"], ["Ba", "Barium"], ["La", "Lanthanum"], ["Ce", "Cerium"], ["Pr", "Praseodymium"], ["Nd", "Neodymium"],
  ["Pm", "Promethium"], ["Sm", "Samarium"], ["Eu", "Europium"], ["Gd", "Gadolinium"], ["Tb", "Terbium"], ["Dy", "Dysprosium"], ["Ho", "Holmium"], ["Er", "Erbium"], ["Tm", "Thulium"], ["Yb", "Ytterbium"],
  ["Lu", "Lutetium"], ["Hf", "Hafnium"], ["Ta", "Tantalum"], ["W", "Tungsten"], ["Re", "Rhenium"], ["Os", "Osmium"], ["Ir", "Iridium"], ["Pt", "Platinum"], ["Au", "Gold"], ["Hg", "Mercury"],
  ["Tl", "Thallium"], ["Pb", "Lead"], ["Bi", "Bismuth"], ["Po", "Polonium"], ["At", "Astatine"], ["Rn", "Radon"], ["Fr", "Francium"], ["Ra", "Radium"], ["Ac", "Actinium"], ["Th", "Thorium"],
  ["Pa", "Protactinium"], ["U", "Uranium"], ["Np", "Neptunium"], ["Pu", "Plutonium"], ["Am", "Americium"], ["Cm", "Curium"], ["Bk", "Berkelium"], ["Cf", "Californium"], ["Es", "Einsteinium"], ["Fm", "Fermium"],
  ["Md", "Mendelevium"], ["No", "Nobelium"], ["Lr", "Lawrencium"], ["Rf", "Rutherfordium"], ["Db", "Dubnium"], ["Sg", "Seaborgium"], ["Bh", "Bohrium"], ["Hs", "Hassium"], ["Mt", "Meitnerium"], ["Ds", "Darmstadtium"],
  ["Rg", "Roentgenium"], ["Cn", "Copernicium"], ["Nh", "Nihonium"], ["Fl", "Flerovium"], ["Mc", "Moscovium"], ["Lv", "Livermorium"], ["Ts", "Tennessine"], ["Og", "Oganesson"],
];

const ORBITALS = [["1s", 2], ["2s", 2], ["2p", 6], ["3s", 2], ["3p", 6], ["4s", 2], ["3d", 10], ["4p", 6], ["5s", 2], ["4d", 10], ["5p", 6], ["6s", 2], ["4f", 14], ["5d", 10], ["6p", 6], ["7s", 2], ["5f", 14], ["6d", 10], ["7p", 6]];

const CONFIG_OVERRIDE = {
  24: "1s2 2s2 2p6 3s2 3p6 3d5 4s1",
  29: "1s2 2s2 2p6 3s2 3p6 3d10 4s1",
  41: "1s2 2s2 2p6 3s2 3p6 4s2 3d10 4p6 5s1 4d4",
  42: "1s2 2s2 2p6 3s2 3p6 4s2 3d10 4p6 5s1 4d5",
  44: "1s2 2s2 2p6 3s2 3p6 4s2 3d10 4p6 5s1 4d7",
  45: "1s2 2s2 2p6 3s2 3p6 4s2 3d10 4p6 5s1 4d8",
  46: "1s2 2s2 2p6 3s2 3p6 4s2 3d10 4p6 4d10",
  47: "1s2 2s2 2p6 3s2 3p6 4s2 3d10 4p6 5s1 4d10",
  57: "1s2 2s2 2p6 3s2 3p6 4s2 3d10 4p6 5s2 5d1",
  58: "1s2 2s2 2p6 3s2 3p6 4s2 3d10 4p6 5s2 4f1 5d1",
  64: "1s2 2s2 2p6 3s2 3p6 4s2 3d10 4p6 5s2 4f7 5d1",
  78: "1s2 2s2 2p6 3s2 3p6 4s2 3d10 4p6 5s2 4f14 5d9 6s1",
  79: "1s2 2s2 2p6 3s2 3p6 4s2 3d10 4p6 5s2 4f14 5d10 6s1",
  89: "1s2 2s2 2p6 3s2 3p6 4s2 3d10 4p6 5s2 4d10 5p6 6s2 6d1",
  90: "1s2 2s2 2p6 3s2 3p6 4s2 3d10 4p6 5s2 4d10 5p6 6s2 6d2",
  91: "1s2 2s2 2p6 3s2 3p6 4s2 3d10 4p6 5s2 4d10 5p6 6s2 5f2 6d1",
  92: "1s2 2s2 2p6 3s2 3p6 4s2 3d10 4p6 5s2 4d10 5p6 6s2 5f3 6d1",
  93: "1s2 2s2 2p6 3s2 3p6 4s2 3d10 4p6 5s2 4d10 5p6 6s2 5f4 6d1",
  96: "1s2 2s2 2p6 3s2 3p6 4s2 3d10 4p6 5s2 4d10 5p6 6s2 5f7 6d1",
  103: "1s2 2s2 2p6 3s2 3p6 4s2 3d10 4p6 5s2 4d10 5p6 6s2 4f14 5d10 6p6 7s2 7p1",
};

const NOBLE = [[86, "Rn"], [54, "Xe"], [36, "Kr"], [18, "Ar"], [10, "Ne"], [2, "He"]];

function sortConfig(str) {
  const order = { s: 0, p: 1, d: 2, f: 3 };
  return str.split(" ").filter(Boolean).map((tok) => {
    const m = tok.match(/^(\d)([spdf])(\d+)$/);
    if (!m) return { tok, n: 99, l: 9 };
    return { tok, n: Number(m[1]), l: order[m[2]] };
  }).sort((a, b) => a.n - b.n || a.l - b.l).map((x) => x.tok).join(" ");
}

function electronConfig(z) {
  let full;
  if (CONFIG_OVERRIDE[z]) full = CONFIG_OVERRIDE[z];
  else {
    let left = z;
    const parts = [];
    for (const [name, cap] of ORBITALS) {
      if (left <= 0) break;
      const n = Math.min(cap, left);
      parts.push(name + n);
      left -= n;
    }
    full = parts.join(" ");
  }
  full = sortConfig(full);
  let noble = null, nobleZ = 0;
  for (const [nz, sym] of NOBLE) if (nz < z) { noble = sym; nobleZ = nz; break; }
  if (!noble) return { full, short: full };
  const base = CONFIG_OVERRIDE[nobleZ] || (() => {
    let left = nobleZ;
    const parts = [];
    for (const [name, cap] of ORBITALS) {
      if (left <= 0) break;
      const n = Math.min(cap, left);
      parts.push(name + n);
      left -= n;
    }
    return parts.join(" ");
  })();
  const baseCount = new Map(base.split(" ").map((x) => [x.replace(/\d+$/, ""), Number(x.match(/\d+$/)[0])]));
  const rem = [];
  for (const tok of full.split(" ")) {
    const name = tok.replace(/\d+$/, ""), n = Number(tok.match(/\d+$/)[0]);
    const b = baseCount.get(name) || 0;
    if (n - b > 0) rem.push(name + (n - b));
  }
  return { full, short: `[${noble}]${rem.length ? " " + sortConfig(rem.join(" ")) : ""}` };
}

const GS1_COUNTRY = [
  [0, 19, "美国/加拿大"], [30, 39, "美国"], [60, 139, "美国/加拿大"], [300, 379, "法国/摩纳哥"], [380, 380, "保加利亚"], [383, 383, "斯洛文尼亚"], [385, 385, "克罗地亚"], [387, 387, "波黑"], [389, 389, "黑山"],
  [400, 440, "德国"], [450, 459, "日本"], [460, 469, "俄罗斯"], [470, 470, "吉尔吉斯斯坦"], [471, 471, "中国台湾"], [474, 474, "爱沙尼亚"], [475, 475, "拉脱维亚"], [476, 476, "阿塞拜疆"], [477, 477, "立陶宛"], [478, 478, "乌兹别克斯坦"], [479, 479, "斯里兰卡"],
  [480, 480, "菲律宾"], [481, 481, "白俄罗斯"], [482, 482, "乌克兰"], [484, 484, "摩尔多瓦"], [485, 485, "亚美尼亚"], [486, 486, "格鲁吉亚"], [487, 487, "哈萨克斯坦"], [489, 489, "中国香港"], [490, 499, "日本"],
  [500, 509, "英国"], [520, 520, "希腊"], [528, 528, "黎巴嫩"], [529, 529, "塞浦路斯"], [531, 531, "北马其顿"], [535, 535, "马耳他"], [539, 539, "爱尔兰"], [540, 549, "比利时/卢森堡"], [560, 560, "葡萄牙"], [569, 569, "冰岛"],
  [570, 579, "丹麦"], [590, 590, "波兰"], [594, 594, "罗马尼亚"], [599, 599, "匈牙利"], [600, 601, "南非"], [603, 603, "加纳"], [604, 604, "塞内加尔"], [608, 608, "巴林"], [609, 609, "毛里求斯"], [611, 611, "摩洛哥"],
  [613, 613, "阿尔及利亚"], [615, 615, "尼日利亚"], [616, 616, "肯尼亚"], [618, 618, "科特迪瓦"], [619, 619, "突尼斯"], [620, 620, "坦桑尼亚"], [621, 621, "叙利亚"], [622, 622, "埃及"], [624, 624, "利比亚"], [625, 625, "约旦"],
  [626, 626, "伊朗"], [627, 627, "科威特"], [628, 628, "沙特阿拉伯"], [629, 629, "阿联酋"], [640, 649, "芬兰"], [690, 699, "中国"], [700, 709, "挪威"], [729, 729, "以色列"], [730, 739, "瑞典"], [740, 740, "危地马拉"],
  [741, 741, "萨尔瓦多"], [742, 742, "洪都拉斯"], [743, 743, "尼加拉瓜"], [744, 744, "哥斯达黎加"], [745, 745, "巴拿马"], [746, 746, "多米尼加"], [750, 750, "墨西哥"], [754, 755, "加拿大"], [759, 759, "委内瑞拉"], [760, 769, "瑞士"],
  [770, 770, "哥伦比亚"], [773, 773, "乌拉圭"], [775, 775, "秘鲁"], [777, 777, "玻利维亚"], [779, 779, "阿根廷"], [780, 780, "智利"], [784, 784, "巴拉圭"], [786, 786, "厄瓜多尔"], [789, 790, "巴西"], [800, 839, "意大利"],
  [840, 849, "西班牙"], [850, 850, "古巴"], [858, 858, "斯洛伐克"], [859, 859, "捷克"], [860, 860, "塞尔维亚"], [865, 865, "蒙古"], [867, 867, "朝鲜"], [868, 869, "土耳其"], [870, 879, "荷兰"], [880, 880, "韩国"],
  [885, 885, "泰国"], [888, 888, "新加坡"], [890, 890, "印度"], [893, 893, "越南"], [896, 896, "巴基斯坦"], [899, 899, "印度尼西亚"], [900, 919, "奥地利"], [930, 939, "澳大利亚"], [940, 949, "新西兰"], [955, 955, "马来西亚"], [958, 958, "中国澳门"],
];

const RES_COLORS = { black: 0, brown: 1, red: 2, orange: 3, yellow: 4, green: 5, blue: 6, violet: 7, gray: 8, white: 9, noir: 0, brun: 1, marron: 1, rouge: 2, jaune: 4, vert: 5, bleu: 6, gris: 8, blanc: 9 };
const RES_MULT = { black: 0, brown: 1, red: 2, orange: 3, yellow: 4, green: 5, blue: 6, violet: 7, gray: 8, white: 9, gold: -1, silver: -2, or: -1, argent: -2 };
const RES_TOL = { brown: 1, red: 2, green: 0.5, blue: 0.25, violet: 0.1, gray: 0.05, gold: 5, silver: 10, none: 20 };

function resistorFromValue(v) {
  if (!(v > 0)) throw new Error("阻值需为正数");
  let e = 0, m = v;
  while (m >= 100) { m /= 10; e++; }
  while (m < 10) { m *= 10; e--; }
  const d1 = Math.floor(m / 10), d2 = Math.round(m % 10);
  const name = Object.entries(RES_COLORS).find(([, x]) => x === d1)?.[0] || "black";
  const name2 = Object.entries(RES_COLORS).find(([, x]) => x === d2)?.[0] || "black";
  const mult = Object.entries(RES_MULT).find(([, x]) => x === e)?.[0];
  if (!mult) throw new Error("阻值超出内置色环范围");
  return `阻值: ${kb(v)}Ω (${v} Ω)\n色环: ${name} ${name2} ${mult} gold\n误差: ±5%`;
}

function powmodBig(b, e, m) {
  b %= m;
  if (b < 0n) b += m;
  let r = 1n;
  while (e > 0n) {
    if (e & 1n) r = (r * b) % m;
    b = (b * b) % m;
    e >>= 1n;
  }
  return r;
}

function boolNorm(src) {
  return String(src)
    .replace(/[∧·]/g, "&")
    .replace(/[∨+]/g, "|")
    .replace(/[¬~]/g, "!")
    .replace(/[⊕]/g, "^")
    .replace(/\bAND\b/gi, "&")
    .replace(/\bOR\b/gi, "|")
    .replace(/\bNOT\b/gi, "!")
    .replace(/\bXOR\b/gi, "^");
}

function boolTokenize(src) {
  const s = boolNorm(src);
  const toks = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    if ("&|!^()".includes(c)) { toks.push(c); i++; continue; }
    if (/[01]/.test(c)) { toks.push(c); i++; continue; }
    if (/[A-Za-z_]/.test(c)) {
      let j = i + 1;
      while (j < s.length && /[A-Za-z0-9_]/.test(s[j])) j++;
      toks.push(s.slice(i, j));
      i = j;
      continue;
    }
    throw new Error(`布尔表达式出现非法字符「${c}」`);
  }
  return toks;
}

function boolVars(src) {
  const toks = boolTokenize(src);
  const skip = new Set(["true", "false", "TRUE", "FALSE", "True", "False"]);
  return [...new Set(toks.filter((t) => /^[A-Za-z_]/.test(t) && !skip.has(t)))].sort((a, b) => a.localeCompare(b));
}

function boolRpn(src) {
  const toks = boolTokenize(src);
  const out = [], ops = [];
  const prec = { "!": 4, "&": 3, "^": 2, "|": 1 };
  let prev = null;
  for (const t of toks) {
    if (t === "(") ops.push(t);
    else if (t === ")") {
      while (ops.length && ops[ops.length - 1] !== "(") out.push(ops.pop());
      if (!ops.length) throw new Error("括号不匹配");
      ops.pop();
    } else if ("&|^!".includes(t)) {
      if (t === "!" && prev && (/^[A-Za-z_]/.test(prev) || prev === ")" || prev === "0" || prev === "1")) throw new Error("! 前缺少运算符");
      while (ops.length && ops[ops.length - 1] !== "(" && (prec[ops[ops.length - 1]] || 0) >= prec[t] && t !== "!") out.push(ops.pop());
      ops.push(t);
    } else out.push(t);
    prev = t;
  }
  while (ops.length) {
    const op = ops.pop();
    if (op === "(") throw new Error("括号不匹配");
    out.push(op);
  }
  return out;
}

function boolEval(src, env) {
  const rpn = boolRpn(src);
  const st = [];
  for (const t of rpn) {
    if (t === "!") {
      if (!st.length) throw new Error("! 缺少操作数");
      st.push(!st.pop());
    } else if ("&|^".includes(t)) {
      if (st.length < 2) throw new Error(`${t} 缺少操作数`);
      const b = st.pop(), a = st.pop();
      st.push(t === "&" ? a && b : t === "|" ? a || b : Boolean(a) !== Boolean(b));
    } else if (t === "0" || t === "1") st.push(t === "1");
    else if (/^(true|false)$/i.test(t)) st.push(/^true$/i.test(t));
    else {
      if (!(t in env)) throw new Error(`缺少变量 ${t}`);
      st.push(Boolean(env[t]));
    }
  }
  if (st.length !== 1) throw new Error("表达式无法归约为布尔值");
  return st[0];
}

function boolDual(src) {
  const toks = boolTokenize(src);
  return toks.map((t) => t === "&" ? "|" : t === "|" ? "&" : t === "0" ? "1" : t === "1" ? "0" : t).join(" ").replace(/\s*([()!^])\s*/g, " $1 ").replace(/\s+/g, " ").trim();
}

function qmCovers(cube, m, n) {
  const bits = m.toString(2).padStart(n, "0");
  for (let i = 0; i < n; i++) if (cube[i] !== "-" && cube[i] !== bits[i]) return false;
  return true;
}

function qmMinimize(minterms, vars) {
  const n = vars.length;
  let cubes = minterms.map((m) => ({ bits: m.toString(2).padStart(n, "0"), used: false }));
  const primes = [];
  while (cubes.length) {
    const used = new Array(cubes.length).fill(false);
    const next = new Map();
    for (let i = 0; i < cubes.length; i++) for (let j = i + 1; j < cubes.length; j++) {
      let diff = -1, ok = true;
      for (let k = 0; k < n; k++) {
        if (cubes[i].bits[k] !== cubes[j].bits[k]) {
          if (diff >= 0) { ok = false; break; }
          diff = k;
        }
      }
      if (ok && diff >= 0) {
        used[i] = used[j] = true;
        const bits = cubes[i].bits.slice(0, diff) + "-" + cubes[i].bits.slice(diff + 1);
        next.set(bits, { bits, used: false });
      }
    }
    for (let i = 0; i < cubes.length; i++) if (!used[i]) primes.push(cubes[i].bits);
    cubes = [...next.values()];
  }
  const uniq = [...new Set(primes)];
  const uncovered = new Set(minterms);
  const chosen = [];
  while (uncovered.size) {
    let best = null, bestCov = [];
    for (const cube of uniq) {
      const cov = [...uncovered].filter((m) => qmCovers(cube, m, n));
      if (cov.length > bestCov.length) { best = cube; bestCov = cov; }
    }
    if (!best || !bestCov.length) break;
    chosen.push(best);
    for (const m of bestCov) uncovered.delete(m);
  }
  const terms = chosen.map((cube) => {
    const lits = [];
    for (let i = 0; i < n; i++) {
      if (cube[i] === "1") lits.push(vars[i]);
      else if (cube[i] === "0") lits.push("!" + vars[i]);
    }
    return lits.length ? lits.join(" & ") : "1";
  });
  return terms.join(" | ") || "0";
}

const D4_CATS = ["Traitement de Données (Autre/non classé)","Codage de Caractères","Informatique (Autre/non classé)","Système de Notation","Traitement d'Image","dCode","Compression","Système de Communication (Autre/non classé)","Stéganographie","Chiffrement par Transposition","Langage de Programmation","Cryptographie Moderne","Système de Numération","Chiffrement Polygrammique","Données Brutes","Electronique","Cryptographie (Autre/non classé)","Cryptanalyse","Fonction de Hachage","Somme de Contrôle","Geek"];
const D4_TOOL_ROWS = `0	Acronymes	generateur-acronyme	https://www.dcode.fr/generateur-acronyme
0	Analyseur d'Expression Rationnelle	analyseur-expression-rationnelle	https://www.dcode.fr/analyseur-expression-rationnelle
0	Calculatrice d'Arrondi	calculatrice-arrondi	https://www.dcode.fr/calculatrice-arrondi
0	Compteur d'Expressions	compteur-expressions	https://www.dcode.fr/compteur-expressions
0	Compteur de Mots	compteur-mots	https://www.dcode.fr/compteur-mots
0	Différences entre 2 Textes	differences-2-textes	https://www.dcode.fr/differences-2-textes
0	Distance de Hamming	distance-hamming	https://www.dcode.fr/distance-hamming
0	Distance de Levenshtein	distance-levenshtein	https://www.dcode.fr/distance-levenshtein
0	Doublons dans une Liste	detecteur-doublon	https://www.dcode.fr/detecteur-doublon
0	Découpage en Blocs de Lettres	decoupage-blocs-letters	https://www.dcode.fr/decoupage-blocs-letters
0	Découpeur de Texte	decoupeur-texte	https://www.dcode.fr/decoupeur-texte
0	Détecteur de Plagiat	detecteur-plagiat	https://www.dcode.fr/detecteur-plagiat
0	Eléments Non Communs	elements-non-communs	https://www.dcode.fr/elements-non-communs
0	Eléments en Commun	elements-communs	https://www.dcode.fr/elements-communs
0	Extracteur d'Acrostiche	extraction-acrostiche	https://www.dcode.fr/extraction-acrostiche
0	Extraction de Lettres	extraction-lettres	https://www.dcode.fr/extraction-lettres
0	Fautes de Frappe	generateur-fautes-frappe	https://www.dcode.fr/generateur-fautes-frappe
0	Filtres de Combinaisons	filtre-combinaisons	https://www.dcode.fr/filtre-combinaisons
0	Générateur d'Homoglyphes/Homographes	generateur-homoglyphes-homographes	https://www.dcode.fr/generateur-homoglyphes-homographes
0	Générateur de Liste d'Abréviations	generateur-liste-abreviation	https://www.dcode.fr/generateur-liste-abreviation
0	Générateur de Texte (Chaine de Markov)	chaine-markov-texte	https://www.dcode.fr/chaine-markov-texte
0	Loi de Benford	loi-benford	https://www.dcode.fr/loi-benford
0	Matrice de Confusion	matrice-de-confusion	https://www.dcode.fr/matrice-de-confusion
0	Maximum d'une Liste	maximum-liste	https://www.dcode.fr/maximum-liste
0	Mediane de Nombres	mediane	https://www.dcode.fr/mediane
0	Metaphone	cle-metaphone	https://www.dcode.fr/cle-metaphone
0	Minimum d'une Liste	minimum-liste	https://www.dcode.fr/minimum-liste
0	Moyenne Arithmétique	moyenne-arithmetique	https://www.dcode.fr/moyenne-arithmetique
0	Moyenne Géométrique	moyenne-geometrique	https://www.dcode.fr/moyenne-geometrique
0	Moyenne Pondérée de Nombres	moyenne-ponderee	https://www.dcode.fr/moyenne-ponderee
0	Moyenne de Nombres	moyenne	https://www.dcode.fr/moyenne
0	Nombre de Caractères	compter-caracteres-lettres-texte	https://www.dcode.fr/compter-caracteres-lettres-texte
0	Nombres Finissant Par…	nombres-finissant-par-certains-chiffres	https://www.dcode.fr/nombres-finissant-par-certains-chiffres
0	Nombres Pairs ou Impairs	pair-impair	https://www.dcode.fr/pair-impair
0	Point Commun	point-commun	https://www.dcode.fr/point-commun
0	Précision et Rappel	precision-rappel	https://www.dcode.fr/precision-rappel
0	Quantile de Nombres	quantile-nombres	https://www.dcode.fr/quantile-nombres
0	Quartile de Nombres	calcul-quartiles	https://www.dcode.fr/calcul-quartiles
0	Recherche par Expression Régulière	recherche-regexp	https://www.dcode.fr/recherche-regexp
0	Reconnaissance de Langue	reconnaissance-langue	https://www.dcode.fr/reconnaissance-langue
0	Remplacement par Expression Régulière	remplacement-regexp	https://www.dcode.fr/remplacement-regexp
0	Sensibilité et Spécificité	sensibilite-specificite	https://www.dcode.fr/sensibilite-specificite
0	Signe (Positif/Négatif)	signe-positif-negatif	https://www.dcode.fr/signe-positif-negatif
0	Simplificateur d'Expressions Rationnelles	simplification-expressions-rationnelles	https://www.dcode.fr/simplification-expressions-rationnelles
0	Soundex	cle-soundex	https://www.dcode.fr/cle-soundex
0	Suppression des Espaces	suppression-espaces	https://www.dcode.fr/suppression-espaces
0	Séparateur de Syllabes	separateur-syllabes	https://www.dcode.fr/separateur-syllabes
0	Séparation par des Virgules	separation-valeurs	https://www.dcode.fr/separation-valeurs
0	Tri de Lettres	tri-lettres	https://www.dcode.fr/tri-lettres
0	Tri de Liste	tri-liste	https://www.dcode.fr/tri-liste
0	Variations de Mot de Passe	variation-mot-passe	https://www.dcode.fr/variation-mot-passe
0	Voyelles et Consonnes	voyelles-consonnes	https://www.dcode.fr/voyelles-consonnes
0	Zeros Initiaux	zeros-initiaux	https://www.dcode.fr/zeros-initiaux
1	Afficheur 7-Segments	afficheur-7-segments	https://www.dcode.fr/afficheur-7-segments
1	Base-32 Crockford	code-base-32-crockford	https://www.dcode.fr/code-base-32-crockford
1	Base32	code-base-32	https://www.dcode.fr/code-base-32
1	Base 58	chiffre-base-58	https://www.dcode.fr/chiffre-base-58
1	Base100 💯	code-base100-emoji	https://www.dcode.fr/code-base100-emoji
1	Base65536	encodage-base65536	https://www.dcode.fr/encodage-base65536
1	Codage ASCII85	code-ascii-85	https://www.dcode.fr/code-ascii-85
1	Codage Base45	codage-base45	https://www.dcode.fr/codage-base45
1	Codage Base62	codage-base62	https://www.dcode.fr/codage-base62
1	Codage EBCDIC	codage-ebcdic	https://www.dcode.fr/codage-ebcdic
1	Codage Unicode	codage-unicode	https://www.dcode.fr/codage-unicode
1	Code-Barres Aztec	code-barres-aztec	https://www.dcode.fr/code-barres-aztec
1	Code ASCII	code-ascii	https://www.dcode.fr/code-ascii
1	Code Barres 39	code-barres-code-39	https://www.dcode.fr/code-barres-code-39
1	Code Barres 93	code-barres-code-93	https://www.dcode.fr/code-barres-code-93
1	Code Barres 128	code-barres-code-128	https://www.dcode.fr/code-barres-code-128
1	Code Barres Codabar	code-barres-codabar	https://www.dcode.fr/code-barres-codabar
1	Code Barres EAN8	code-barres-ean8	https://www.dcode.fr/code-barres-ean8
1	Code Barres EAN13	code-barres-ean13	https://www.dcode.fr/code-barres-ean13
1	Code Barres PLANET	code-barres-planet	https://www.dcode.fr/code-barres-planet
1	Code Barres POSTNET	code-barres-code-postnet	https://www.dcode.fr/code-barres-code-postnet
1	Code Barres Postal Français	code-barres-postal-francais	https://www.dcode.fr/code-barres-postal-francais
1	Code Base64	code-base-64	https://www.dcode.fr/code-base-64
1	Code Base91	code-base-91	https://www.dcode.fr/code-base-91
1	Code Base 92	codage-base92	https://www.dcode.fr/codage-base92
1	Code Baudot	code-baudot	https://www.dcode.fr/code-baudot
1	Code Binaire	code-binaire	https://www.dcode.fr/code-binaire
1	Code Bubble Babble	code-bubble-babble	https://www.dcode.fr/code-bubble-babble
1	Code Excess-3 (Stibitz)	code-excess-3	https://www.dcode.fr/code-excess-3
1	Code Gray	code-gray	https://www.dcode.fr/code-gray
1	Code Hexagramme	hexagramme	https://www.dcode.fr/hexagramme
1	Code QR	code-qr	https://www.dcode.fr/code-qr
1	Code Unaire Chuck Norris	code-chuck-norris	https://www.dcode.fr/code-chuck-norris
1	Décodage d'URL	decodage-url	https://www.dcode.fr/decodage-url
1	Echappement Unicode	echappement-unicode	https://www.dcode.fr/echappement-unicode
1	Ecriture Zalgo	obfuscation-diacritiques	https://www.dcode.fr/obfuscation-diacritiques
1	Entiers 32 Bits	entiers-32-bits	https://www.dcode.fr/entiers-32-bits
1	Espace Invisible (ZWSP)	espace-sans-chasse	https://www.dcode.fr/espace-sans-chasse
1	Générateur de Code-Barres	code-barres	https://www.dcode.fr/code-barres
1	LEB128	encodage-leb128	https://www.dcode.fr/encodage-leb128
1	Police Wingdings	police-wingdings	https://www.dcode.fr/police-wingdings
1	Punycode	codage-punycode	https://www.dcode.fr/codage-punycode
1	UUencode	encodage-uu	https://www.dcode.fr/encodage-uu
1	Z-Base-32	code-z-base-32	https://www.dcode.fr/code-z-base-32
2	Calculatrice Bit-à-Bit	calculatrice-bit-a-bit	https://www.dcode.fr/calculatrice-bit-a-bit
2	Caractères de Controles ASCII	caracteres-controle-ascii	https://www.dcode.fr/caracteres-controle-ascii
2	Code Correcteur de Hamming	hamming-correction-erreur	https://www.dcode.fr/hamming-correction-erreur
2	Commentaires HTML	commentaires-html	https://www.dcode.fr/commentaires-html
2	Commentaires Zip	commentaires-zip	https://www.dcode.fr/commentaires-zip
2	Couleur en Nombre	couleur-en-nombre	https://www.dcode.fr/couleur-en-nombre
2	Création de Fichier	fichier-donnees	https://www.dcode.fr/fichier-donnees
2	Dessin sur Clavier Numérique	dessin-clavier-numerique	https://www.dcode.fr/dessin-clavier-numerique
2	Distance de Hamming	distance-hamming	https://www.dcode.fr/distance-hamming
2	Fautes de Frappe	generateur-fautes-frappe	https://www.dcode.fr/generateur-fautes-frappe
2	Fonction de Hachage	fonction-hash	https://www.dcode.fr/fonction-hash
2	Hash NTLM	hash-ntlm	https://www.dcode.fr/hash-ntlm
2	Hex Dump	dump-hexadecimal	https://www.dcode.fr/dump-hexadecimal
2	Hexadécimal (Base 16)	systeme-hexadecimal	https://www.dcode.fr/systeme-hexadecimal
2	Identification de Hash	identification-hash	https://www.dcode.fr/identification-hash
2	Indice de Shannon	indice-shannon	https://www.dcode.fr/indice-shannon
2	Inversion d'Ordre de Bits	inversion-ordre-bits	https://www.dcode.fr/inversion-ordre-bits
2	Inversion de Bits	inversion-bit	https://www.dcode.fr/inversion-bit
2	Keysmash	keysmash-clavier	https://www.dcode.fr/keysmash-clavier
2	Little/Big Endian	convertisseur-boutisme	https://www.dcode.fr/convertisseur-boutisme
2	Mot de Passe Zip	mot-de-passe-zip	https://www.dcode.fr/mot-de-passe-zip
2	Négabinaire	systeme-negabinaire	https://www.dcode.fr/systeme-negabinaire
2	Position des Bits en Binaire	position-bits-binaire	https://www.dcode.fr/position-bits-binaire
2	Registre à Décalage à Rétroaction Linéaire	registre-decalage-retroaction-lineaire	https://www.dcode.fr/registre-decalage-retroaction-lineaire
2	Schéma de Verrouillage Android	schema-verrouillage-android	https://www.dcode.fr/schema-verrouillage-android
2	Timestamp	convertisseur-timestamp	https://www.dcode.fr/convertisseur-timestamp
2	Timestamp Windows	timestamp-windows	https://www.dcode.fr/timestamp-windows
2	UUID	identifiant-uuid	https://www.dcode.fr/identifiant-uuid
3	Codage Elias Delta	codage-elias-delta	https://www.dcode.fr/codage-elias-delta
3	Codage Elias Gamma	codage-elias-gamma	https://www.dcode.fr/codage-elias-gamma
3	Code Braille GS8	code-braille-gs8	https://www.dcode.fr/code-braille-gs8
3	Code Commune INSEE	code-commune-insee	https://www.dcode.fr/code-commune-insee
3	Code Livre ISBN	code-livre-isbn	https://www.dcode.fr/code-livre-isbn
3	Code Parsons	code-parsons	https://www.dcode.fr/code-parsons
3	Code Postal	code-postal	https://www.dcode.fr/code-postal
3	Codons (Code Génétique)	codons-code-genetique	https://www.dcode.fr/codons-code-genetique
3	Configuration Electronique des Atomes	configuration-electronique	https://www.dcode.fr/configuration-electronique
3	Encadrement d'un Nombre	encadrement-mathematique	https://www.dcode.fr/encadrement-mathematique
3	Ensembles de Nombres	ensembles-nombres	https://www.dcode.fr/ensembles-nombres
3	Flèches de Knuth	fleches-knuth	https://www.dcode.fr/fleches-knuth
3	Langue Ithkuil	langue-ithkuil	https://www.dcode.fr/langue-ithkuil
3	Marquage Alpha Angle	marquage-alpha-angle	https://www.dcode.fr/marquage-alpha-angle
3	Notation Algébrique aux Echecs	notation-san-echecs	https://www.dcode.fr/notation-san-echecs
3	Notation Echecs UCI	notation-echecs-uci	https://www.dcode.fr/notation-echecs-uci
3	Notation Forsyth-Edwards	notation-echecs-fen	https://www.dcode.fr/notation-echecs-fen
3	Notation Laban	notation-laban	https://www.dcode.fr/notation-laban
3	Notation Polonaise Inverse	notation-polonaise-inverse	https://www.dcode.fr/notation-polonaise-inverse
3	Notation des Accords de Guitare	notation-accords-guitare	https://www.dcode.fr/notation-accords-guitare
3	Notation des Noeuds	notation-noeuds	https://www.dcode.fr/notation-noeuds
3	Notations du Jeu d'Echecs	notation-echecs	https://www.dcode.fr/notation-echecs
3	Numération Chinoise	numeration-chinoise	https://www.dcode.fr/numeration-chinoise
3	Numéro Atomique (Table Périodique)	substitution-numero-atomique	https://www.dcode.fr/substitution-numero-atomique
3	Pays des Code-Barres	pays-code-barres	https://www.dcode.fr/pays-code-barres
3	Position des Bits en Binaire	position-bits-binaire	https://www.dcode.fr/position-bits-binaire
3	Puissances de 10	puissances-de-10	https://www.dcode.fr/puissances-de-10
3	Rang dans un Nombre	rang-chiffre-nombre	https://www.dcode.fr/rang-chiffre-nombre
4	Canaux CMJN	canaux-cmjn	https://www.dcode.fr/canaux-cmjn
4	Canaux RVB	canaux-rvb	https://www.dcode.fr/canaux-rvb
4	Canaux TSL	canaux-tsl	https://www.dcode.fr/canaux-tsl
4	Canaux d'une Image	canaux-image	https://www.dcode.fr/canaux-image
4	Chunks PNG	chunks-png	https://www.dcode.fr/chunks-png
4	Code-Barres Aztec	code-barres-aztec	https://www.dcode.fr/code-barres-aztec
4	Code Barres 39	code-barres-code-39	https://www.dcode.fr/code-barres-code-39
4	Code Barres 93	code-barres-code-93	https://www.dcode.fr/code-barres-code-93
4	Code Barres 128	code-barres-code-128	https://www.dcode.fr/code-barres-code-128
4	Code Barres Codabar	code-barres-codabar	https://www.dcode.fr/code-barres-codabar
4	Code Barres EAN8	code-barres-ean8	https://www.dcode.fr/code-barres-ean8
4	Code Barres EAN13	code-barres-ean13	https://www.dcode.fr/code-barres-ean13
4	Code Barres PLANET	code-barres-planet	https://www.dcode.fr/code-barres-planet
4	Code Barres POSTNET	code-barres-code-postnet	https://www.dcode.fr/code-barres-code-postnet
4	Code Barres Postal Français	code-barres-postal-francais	https://www.dcode.fr/code-barres-postal-francais
4	Code QR	code-qr	https://www.dcode.fr/code-qr
4	Données EXIF	donnees-exif	https://www.dcode.fr/donnees-exif
4	Drapeaux du Monde	drapeaux	https://www.dcode.fr/drapeaux
4	Générateur de Code-Barres	code-barres	https://www.dcode.fr/code-barres
4	Histogramme d'une Image	histogramme-image	https://www.dcode.fr/histogramme-image
4	Image Binaire 0 1	image-binaire	https://www.dcode.fr/image-binaire
4	Image CPBitmap	format-cpbitmap	https://www.dcode.fr/format-cpbitmap
4	Image de Pixels Aléatoires	image-pixels-aleatoires	https://www.dcode.fr/image-pixels-aleatoires
4	Image en Niveaux de Gris	image-niveaux-gris	https://www.dcode.fr/image-niveaux-gris
4	Image en Nombres	image-chiffres	https://www.dcode.fr/image-chiffres
4	Lecture de Pixels	lecture-pixel-image	https://www.dcode.fr/lecture-pixel-image
4	Miniature EXIF	miniature-exif	https://www.dcode.fr/miniature-exif
4	OCR - Reconnaissance de Caractères	ocr-reconnaissance-de-caracteres-texte	https://www.dcode.fr/ocr-reconnaissance-de-caracteres-texte
5	★ Reconnaitre un Chiffrement	identification-chiffrement	https://www.dcode.fr/identification-chiffrement
5	A Propos de dCode	a-propos	https://www.dcode.fr/a-propos
5	Application Mobile dCode	application-mobile	https://www.dcode.fr/application-mobile
5	Liste des Outils dCode	liste-outils	https://www.dcode.fr/liste-outils
5	dCode.fr	fr	https://www.dcode.fr/fr
5	Liste de Tous les Outils	#f0	https://www.dcode.fr/#f0
5	Qu'est-ce qu'un outil sur dCode ? (Définition)	#q1	https://www.dcode.fr/#q1
5	Comment avoir la liste de tous les outils sur dCode ?	#q2	https://www.dcode.fr/#q2
5	Comment utiliser un outil sur dCode ?	#q3	https://www.dcode.fr/#q3
5	Comment proposer un nouvel outil ?	#q4	https://www.dcode.fr/#q4
5	Quels sont les critères d'admissibilité d'un outil sur dCode ?	#q5	https://www.dcode.fr/#q5
5	dCode.fr	fr	https://www.dcode.fr/fr
5	Reconnaitre un Chiffrement	identification-chiffrement	https://www.dcode.fr/identification-chiffrement
5	A Propos de dCode	a-propos	https://www.dcode.fr/a-propos
5	Application Mobile dCode	application-mobile	https://www.dcode.fr/application-mobile
5	Chiffrements du Moyen-Age	chiffrements-moyen-age	https://www.dcode.fr/chiffrements-moyen-age
5	Chiffrements Multi-Couches	chiffrements-multi-couches	https://www.dcode.fr/chiffrements-multi-couches
5	Solveur Wordament	solveur-wordament	https://www.dcode.fr/solveur-wordament
5	LISTE DES OUTILS DCODE	liste-outils	https://www.dcode.fr/liste-outils
5	Paypal	webscr?cmd=_s-xclick&hosted_button_id=S53H3S52HJH6N&source=url	https://www.dcode.fr/https://www.paypal.com/cgi-bin/webscr?cmd=_s-xclick&hosted_button_id=S53H3S52HJH6N&source=url
5	Crypto-monnaies	javascript:;	https://www.dcode.fr/javascript:;
5	Discord	AT9V5Vq	https://www.dcode.fr/https://discord.gg/AT9V5Vq
5	Contact	a-propos	https://www.dcode.fr/a-propos
5	A propos	a-propos	https://www.dcode.fr/a-propos
5	Application	application-mobile	https://www.dcode.fr/application-mobile
5	Prise2Tete		https://www.dcode.fr/http://www.prise2tete.fr/
5	Wikipedia		https://www.dcode.fr/https://fr.wikipedia.org/
6	Codage Elias Delta	codage-elias-delta	https://www.dcode.fr/codage-elias-delta
6	Codage Elias Gamma	codage-elias-gamma	https://www.dcode.fr/codage-elias-gamma
6	Codage de Fibonacci	codage-fibonacci	https://www.dcode.fr/codage-fibonacci
6	Codage de Huffman	codage-huffman-compression	https://www.dcode.fr/codage-huffman-compression
6	Codage de NegaFibonacci	codage-negafibonacci	https://www.dcode.fr/codage-negafibonacci
6	Compression Deflate	compression-deflate	https://www.dcode.fr/compression-deflate
6	Compression GZIP	compression-gzip	https://www.dcode.fr/compression-gzip
6	Compression LZW	compression-lzw	https://www.dcode.fr/compression-lzw
6	Compression ZLIB	compression-zlib	https://www.dcode.fr/compression-zlib
6	RLE (Run-Length Encoding)	compression-rle	https://www.dcode.fr/compression-rle
6	Transformée de Burrows-Wheeler	transformee-burrows-wheeler	https://www.dcode.fr/transformee-burrows-wheeler
6	Algorithme de Kaprekar	algorithme-kaprekar	https://www.dcode.fr/algorithme-kaprekar
6	Chiffres Aléatoires	chiffre-aleatoire	https://www.dcode.fr/chiffre-aleatoire
6	Conjecture de Pólya	conjecture-polya	https://www.dcode.fr/conjecture-polya
6	Echantillon Aléatoire	echantillon-aleatoire	https://www.dcode.fr/echantillon-aleatoire
6	Générateur d'Arbre de Tournoi	generateur-tournoi-arbre	https://www.dcode.fr/generateur-tournoi-arbre
6	Générateur de Championnat	generateur-championnat	https://www.dcode.fr/generateur-championnat
6	Générateur de Championnat par Paires	generateur-championnat-paires	https://www.dcode.fr/generateur-championnat-paires
6	Générateur de Tournoi Americano	generateur-tournoi-americano	https://www.dcode.fr/generateur-tournoi-americano
6	Jeu de la Vie	jeu-de-la-vie	https://www.dcode.fr/jeu-de-la-vie
6	Nombres Aléatoires	nombre-aleatoire	https://www.dcode.fr/nombre-aleatoire
6	Syllogismes	syllogisme	https://www.dcode.fr/syllogisme
6	Tirage au Sort	tirage-au-sort	https://www.dcode.fr/tirage-au-sort
7	Accent Allemand	accent-allemand	https://www.dcode.fr/accent-allemand
7	Accent Anglais	accent-anglais	https://www.dcode.fr/accent-anglais
7	Accent Asiatique	accent-asiatique	https://www.dcode.fr/accent-asiatique
7	Accent Espagnol	accent-hispanique	https://www.dcode.fr/accent-hispanique
7	Accent Etranger	accent-etranger	https://www.dcode.fr/accent-etranger
7	Accent Français	accent-francais	https://www.dcode.fr/accent-francais
7	Accent Italien	accent-italien	https://www.dcode.fr/accent-italien
7	Accent Russe	accent-russe	https://www.dcode.fr/accent-russe
7	Alphabet Braille	alphabet-braille	https://www.dcode.fr/alphabet-braille
7	Alphabet Phonétique de l'OTAN	alphabet-phonetique-otan	https://www.dcode.fr/alphabet-phonetique-otan
7	Alphabet Sémaphore	alphabet-semaphore	https://www.dcode.fr/alphabet-semaphore
7	Code Chappe	code-chappe	https://www.dcode.fr/code-chappe
7	Code des Signaux Maritimes	code-signal-maritime	https://www.dcode.fr/code-signal-maritime
7	Ecriture 1337 Leet Speak	ecriture-1337-leet-speak	https://www.dcode.fr/ecriture-1337-leet-speak
7	Ecriture Dotsies	ecriture-dotsies	https://www.dcode.fr/ecriture-dotsies
7	Langage Iokharique	langage-iokharique	https://www.dcode.fr/langage-iokharique
7	Langue des Signes Américaine	langue-des-signes-americaine	https://www.dcode.fr/langue-des-signes-americaine
7	Langue des Signes Française	langue-des-signes-francaise	https://www.dcode.fr/langue-des-signes-francaise
7	Majuscule et Minuscule	majuscules-minuscules	https://www.dcode.fr/majuscules-minuscules
7	Marques de Dénombrement	marques-unaires	https://www.dcode.fr/marques-unaires
7	★ Reconnaitre un Chiffrement	identification-chiffrement	https://www.dcode.fr/identification-chiffrement
8	Analyse Spectrale	analyse-spectrale	https://www.dcode.fr/analyse-spectrale
8	Charabia Latin	charabia-latin	https://www.dcode.fr/charabia-latin
8	Chiffre Friderici (Fenêtres)	chiffre-friderici-fenetres	https://www.dcode.fr/chiffre-friderici-fenetres
8	Chiffrement par Dissimulation	chiffrement-dissimulation	https://www.dcode.fr/chiffrement-dissimulation
8	Code Trevanion	chiffre-trevanion	https://www.dcode.fr/chiffre-trevanion
8	Ecriture Boustrophédon	ecriture-boustrophedon	https://www.dcode.fr/ecriture-boustrophedon
8	Ecriture Spéculaire (en Miroir)	ecriture-speculaire-miroir	https://www.dcode.fr/ecriture-speculaire-miroir
8	Ecriture en Sens Inverse > esrevnI	ecriture-sens-inverse	https://www.dcode.fr/ecriture-sens-inverse
8	Ecriture à l'Envers > sɹǝʌuƎ	ecriture-a-l-envers	https://www.dcode.fr/ecriture-a-l-envers
8	Extracteur d'Acrostiche	extraction-acrostiche	https://www.dcode.fr/extraction-acrostiche
8	Extraction de Lettres	extraction-lettres	https://www.dcode.fr/extraction-lettres
8	Formes de Caractères Binaires	binaire-forme-caractere	https://www.dcode.fr/binaire-forme-caractere
8	Grille de Cardan	grille-cardan	https://www.dcode.fr/grille-cardan
8	Générateur d'Anacycliques	generateur-anacycliques	https://www.dcode.fr/generateur-anacycliques
8	Générateur d'Anagrammes	generateur-anagrammes	https://www.dcode.fr/generateur-anagrammes
8	Générateur de Palindromes	generateur-palindromes	https://www.dcode.fr/generateur-palindromes
8	Javanais	argot-javanais	https://www.dcode.fr/argot-javanais
8	Louchebem	langage-louchebem	https://www.dcode.fr/langage-louchebem
8	Majuscule et Minuscule	majuscules-minuscules	https://www.dcode.fr/majuscules-minuscules
8	Pig Latin	langage-pig-latin	https://www.dcode.fr/langage-pig-latin
8	Traits des Lettres	chiffre-traits-lettre	https://www.dcode.fr/chiffre-traits-lettre
9	Alphagrammes	alphagrammes	https://www.dcode.fr/alphagrammes
9	Chiffre ADFGVX	chiffre-adfgvx	https://www.dcode.fr/chiffre-adfgvx
9	Chiffre ADFGX	chiffre-adfgx	https://www.dcode.fr/chiffre-adfgx
9	Chiffre AMSCO	chiffre-amsco	https://www.dcode.fr/chiffre-amsco
9	Chiffre Carré de César	chiffre-carre-de-cesar	https://www.dcode.fr/chiffre-carre-de-cesar
9	Chiffre Double Transposition	chiffre-double-transposition	https://www.dcode.fr/chiffre-double-transposition
9	Chiffre Rail Fence (Zig-Zag)	chiffre-rail-fence	https://www.dcode.fr/chiffre-rail-fence
9	Chiffre Redefence	chiffre-redefence	https://www.dcode.fr/chiffre-redefence
9	Chiffre Scytale	chiffre-scytale	https://www.dcode.fr/chiffre-scytale
9	Chiffre Swagman	chiffre-swagman	https://www.dcode.fr/chiffre-swagman
9	Chiffre Ubchi	chiffre-ubchi	https://www.dcode.fr/chiffre-ubchi
9	Chiffre par Ecriture Spirale	chiffre-spirale	https://www.dcode.fr/chiffre-spirale
9	Chiffre par Saut (Skip)	chiffre-saut	https://www.dcode.fr/chiffre-saut
9	Chiffre par Transposition	chiffre-transposition	https://www.dcode.fr/chiffre-transposition
9	Chiffre par Transposition de Colonnes	chiffre-transposition-colonnes	https://www.dcode.fr/chiffre-transposition-colonnes
9	Clé de Transposition	cle-transposition	https://www.dcode.fr/cle-transposition
9	Ecriture Chemin	ecriture-chemin	https://www.dcode.fr/ecriture-chemin
9	Grille Tournante	chiffre-grille-tournante	https://www.dcode.fr/chiffre-grille-tournante
9	Kryptos	sculpture-kryptos	https://www.dcode.fr/sculpture-kryptos
10	AAEncode (o^_^o)	encodage-aaencode	https://www.dcode.fr/encodage-aaencode
10	Alphuck	langage-alphuck	https://www.dcode.fr/langage-alphuck
10	Binaryfuck	langage-binaryfuck	https://www.dcode.fr/langage-binaryfuck
10	Blub!	langage-blub	https://www.dcode.fr/langage-blub
10	Brainfuck	langage-brainfuck	https://www.dcode.fr/langage-brainfuck
10	Code Touches Javascript	code-touches-javascript	https://www.dcode.fr/code-touches-javascript
10	Désobfuscateur Javascript	desobfuscateur-javascript	https://www.dcode.fr/desobfuscateur-javascript
10	Langage Deadfish	langage-deadfish	https://www.dcode.fr/langage-deadfish
10	Langage Hodor	langage-hodor	https://www.dcode.fr/langage-hodor
10	Langage JSFuck [][(![]+[])	langage-jsfuck	https://www.dcode.fr/langage-jsfuck
10	Langage LOLCODE	langage-lolcode	https://www.dcode.fr/langage-lolcode
10	Langage Malbolge	langage-malbolge	https://www.dcode.fr/langage-malbolge
10	Langage Whitespace	langage-whitespace	https://www.dcode.fr/langage-whitespace
10	Ook!	langage-ook	https://www.dcode.fr/langage-ook
10	Pikalang	langage-pikalang	https://www.dcode.fr/langage-pikalang
10	ReverseFuck	langage-reversefuck	https://www.dcode.fr/langage-reversefuck
10	Shakespeare (Langage de Programmation)	shakespeare-langage-programmation	https://www.dcode.fr/shakespeare-langage-programmation
10	Spoon	langage-spoon	https://www.dcode.fr/langage-spoon
11	Certificat X.509	certificat-x509	https://www.dcode.fr/certificat-x509
11	Chiffre RC4	chiffre-rc4	https://www.dcode.fr/chiffre-rc4
11	Chiffre RSA	chiffre-rsa	https://www.dcode.fr/chiffre-rsa
11	Chiffre XOR	chiffre-xor	https://www.dcode.fr/chiffre-xor
11	Décalage Circulaire Binaire	decalage-circulaire-binaire	https://www.dcode.fr/decalage-circulaire-binaire
11	Echange de Clés Diffie-Hellman	echange-cle-diffie-hellman	https://www.dcode.fr/echange-cle-diffie-hellman
11	Fonction de Hachage	fonction-hash	https://www.dcode.fr/fonction-hash
11	Hachage avec Crypt()	fonction-hachage-crypt	https://www.dcode.fr/fonction-hachage-crypt
11	Hash NTLM	hash-ntlm	https://www.dcode.fr/hash-ntlm
11	Hash PBKDF2	hash-pbkdf2	https://www.dcode.fr/hash-pbkdf2
11	Identification de Hash	identification-hash	https://www.dcode.fr/identification-hash
11	MD4	hash-md4	https://www.dcode.fr/hash-md4
11	MD5	hash-md5	https://www.dcode.fr/hash-md5
11	SHA-1	hash-sha1	https://www.dcode.fr/hash-sha1
11	SHA-256	hash-sha256	https://www.dcode.fr/hash-sha256
11	SHA-512	hash-sha512	https://www.dcode.fr/hash-sha512
12	Chiffres Romains	chiffres-romains	https://www.dcode.fr/chiffres-romains
12	Chiffres en Bengali	chiffre-bengali	https://www.dcode.fr/chiffre-bengali
12	Nombre en Lettres	ecriture-nombre-lettres	https://www.dcode.fr/ecriture-nombre-lettres
12	Nombres Kaktovik	numeration-kaktovik	https://www.dcode.fr/numeration-kaktovik
12	Nombres des Moines Cisterciens	nombres-cisterciens	https://www.dcode.fr/nombres-cisterciens
12	Nombres en Chiffres	ecriture-mots-nombres	https://www.dcode.fr/ecriture-mots-nombres
12	Numération Babylonienne	nombres-babyloniens	https://www.dcode.fr/nombres-babyloniens
12	Numération D'ni	numeration-dni	https://www.dcode.fr/numeration-dni
12	Numération Egyptienne	numeration-egyptienne	https://www.dcode.fr/numeration-egyptienne
12	Numération Maya	nombres-mayas	https://www.dcode.fr/nombres-mayas
12	Numération Shadoks	numeration-shadok	https://www.dcode.fr/numeration-shadok
12	Soroban	soroban-boulier	https://www.dcode.fr/soroban-boulier
13	Chiffre Digrafide	chiffre-digrafide	https://www.dcode.fr/chiffre-digrafide
13	Chiffre Morbit	chiffre-morbit	https://www.dcode.fr/chiffre-morbit
13	Chiffre PlayFair	chiffre-playfair	https://www.dcode.fr/chiffre-playfair
13	Chiffre Quatre Carrés	chiffre-quatre-carres	https://www.dcode.fr/chiffre-quatre-carres
13	Chiffre de Collon	chiffre-collon	https://www.dcode.fr/chiffre-collon
13	Chiffre de Delastelle	chiffre-bifide-delastelle	https://www.dcode.fr/chiffre-bifide-delastelle
13	Chiffre de Pollux	chiffre-pollux	https://www.dcode.fr/chiffre-pollux
13	Chiffre à Deux Carrés	chiffre-deux-carres	https://www.dcode.fr/chiffre-deux-carres
13	Chiffre à Trois Carrés	chiffre-trois-carres	https://www.dcode.fr/chiffre-trois-carres
13	Code Téléphone Multi-tap (SMS)	code-multitap-abc	https://www.dcode.fr/code-multitap-abc
13	Traits des Lettres	chiffre-traits-lettre	https://www.dcode.fr/chiffre-traits-lettre
14	Cartes de Tarot	cartes-tarot	https://www.dcode.fr/cartes-tarot
14	Cartes à Jouer	cartes-a-jouer	https://www.dcode.fr/cartes-a-jouer
14	Chiffre McCormick	chiffre-mccormick	https://www.dcode.fr/chiffre-mccormick
14	Code Livre ISBN	code-livre-isbn	https://www.dcode.fr/code-livre-isbn
14	Echelle de Monoyer	echelle-monoyer	https://www.dcode.fr/echelle-monoyer
14	Echelle de Snellen	echelle-snellen	https://www.dcode.fr/echelle-snellen
14	HTML	editeur-html	https://www.dcode.fr/editeur-html
14	Javascript	editeur-javascript	https://www.dcode.fr/editeur-javascript
14	Les 4 Elements	4-quatre-elements	https://www.dcode.fr/4-quatre-elements
14	Pièces et Billets	monnaie-pieces-billets	https://www.dcode.fr/monnaie-pieces-billets
14	Symboles Astronomiques	symboles-astronomiques	https://www.dcode.fr/symboles-astronomiques
15	Afficheur 7-Segments	afficheur-7-segments	https://www.dcode.fr/afficheur-7-segments
15	Calcul d'Expressions Booléennes	calcul-expressions-booleennes	https://www.dcode.fr/calcul-expressions-booleennes
15	Code BCD (Binary Coded Decimal)	code-bcd	https://www.dcode.fr/code-bcd
15	Code Couleur des Condensateurs	code-couleur-condensateur	https://www.dcode.fr/code-couleur-condensateur
15	Code Couleur des Résistances	code-couleur-resistance	https://www.dcode.fr/code-couleur-resistance
15	Code Decabit	code-decabit	https://www.dcode.fr/code-decabit
15	Code Gray	code-gray	https://www.dcode.fr/code-gray
15	Dual Booléen	dual-booleen	https://www.dcode.fr/dual-booleen
15	MinTermes et MaxTermes Booléens	calcul-mintermes-maxterms	https://www.dcode.fr/calcul-mintermes-maxterms
15	Table de Karnaugh	table-karnaugh	https://www.dcode.fr/table-karnaugh
15	Table de Vérité	table-verite-logique	https://www.dcode.fr/table-verite-logique
16	★ Reconnaitre un Chiffrement	identification-chiffrement	https://www.dcode.fr/identification-chiffrement
16	Chiffre Base 26	chiffre-base-26	https://www.dcode.fr/chiffre-base-26
16	Chiffre Base 36	chiffre-base-36	https://www.dcode.fr/chiffre-base-36
16	Chiffre Base 37	chiffre-base-37	https://www.dcode.fr/chiffre-base-37
16	Chiffre McCormick	chiffre-mccormick	https://www.dcode.fr/chiffre-mccormick
16	Chiffrements Multi-Couches	chiffrements-multi-couches	https://www.dcode.fr/chiffrements-multi-couches
16	Chiffrements du Moyen-Age	chiffrements-moyen-age	https://www.dcode.fr/chiffrements-moyen-age
16	Générateur d'Alphabet Désordonné	generateur-alphabet-desordonne	https://www.dcode.fr/generateur-alphabet-desordonne
16	Positions des Lettres	positions-lettres	https://www.dcode.fr/positions-lettres
16	★ Reconnaitre un Chiffrement	identification-chiffrement	https://www.dcode.fr/identification-chiffrement
17	★ Reconnaitre un Chiffrement	identification-chiffrement	https://www.dcode.fr/identification-chiffrement
17	Analyse des Fréquences	analyse-frequences	https://www.dcode.fr/analyse-frequences
17	Bigrammes	bigrammes	https://www.dcode.fr/bigrammes
17	Indice de Coïncidence	indice-coincidence	https://www.dcode.fr/indice-coincidence
17	Indice de Shannon	indice-shannon	https://www.dcode.fr/indice-shannon
17	Test de Kasiski	test-kasiski	https://www.dcode.fr/test-kasiski
17	Trigrammes	trigrammes	https://www.dcode.fr/trigrammes
18	MD4	hash-md4	https://www.dcode.fr/hash-md4
18	MD5	hash-md5	https://www.dcode.fr/hash-md5
18	SHA-1	hash-sha1	https://www.dcode.fr/hash-sha1
18	SHA-256	hash-sha256	https://www.dcode.fr/hash-sha256
18	SHA-512	hash-sha512	https://www.dcode.fr/hash-sha512
18	UUID	identifiant-uuid	https://www.dcode.fr/identifiant-uuid
19	Algorithme de Luhn (Vérification de Numéros)	algorithme-luhn	https://www.dcode.fr/algorithme-luhn
19	Algorithme de Verhoeff	algorithme-verhoeff	https://www.dcode.fr/algorithme-verhoeff
19	CRC-32	controle-crc-32	https://www.dcode.fr/controle-crc-32
19	Numéro IBAN	verification-iban	https://www.dcode.fr/verification-iban
19	Numéro de Compte RIB	verification-rib	https://www.dcode.fr/verification-rib
20	Code Geek	code-geek	https://www.dcode.fr/code-geek
20	Ecriture 1337 Leet Speak	ecriture-1337-leet-speak	https://www.dcode.fr/ecriture-1337-leet-speak
20	Ecriture LSPK90 Horaire	lspk90-h-leet-speak-90-degres-horaire	https://www.dcode.fr/lspk90-h-leet-speak-90-degres-horaire`;
const D4_IMPL = {"acronym":["generateur-acronyme"],"expr-frac":["analyseur-expression-rationnelle"],"round":["calculatrice-arrondi"],"count-substr":["compteur-expressions"],"word-count":["compteur-mots"],"text-diff":["differences-2-textes"],"list-dupes":["detecteur-doublon"],"block-split":["decoupage-blocs-letters"],"text-split":["decoupeur-texte"],"plagiarism":["detecteur-plagiat"],"set-diff":["elements-non-communs"],"set-common":["elements-communs"],"letter-extract":["extraction-acrostiche","extraction-lettres"],"typo-gen":["generateur-fautes-frappe"],"combo-filter":["filtre-combinaisons"],"homoglyph":["generateur-homoglyphes-homographes"],"abbrev":["generateur-liste-abreviation"],"markov":["chaine-markov-texte"],"benford":["loi-benford"],"confusion":["matrice-de-confusion"],"list-stats":["maximum-liste","minimum-liste","mediane","moyenne-arithmetique","moyenne-geometrique","moyenne-ponderee","moyenne","quantile-nombres","calcul-quartiles"],"metaphone":["cle-metaphone"],"char-count":["compter-caracteres-lettres-texte"],"numbers-ending":["nombres-finissant-par-certains-chiffres"],"odd-even":["pair-impair"],"common-substr":["point-commun"],"precision-recall":["precision-rappel","sensibilite-specificite"],"lang-detect":["reconnaissance-langue"],"sign":["signe-positif-negatif"],"simplify-frac":["simplification-expressions-rationnelles"],"soundex":["cle-soundex"],"strip-spaces":["suppression-espaces"],"syllables":["separateur-syllabes"],"comma-sep":["separation-valeurs"],"sort-letters":["tri-lettres"],"sort-list":["tri-liste"],"pass-variants":["variation-mot-passe"],"vowel-consonant":["voyelles-consonnes"],"strip-zeros":["zeros-initiaux"],"bit-positions":["position-bits-binaire"],"lfsr":["registre-decalage-retroaction-lineaire"],"android-pattern":["schema-verrouillage-android"],"uuid":["identifiant-uuid"],"int32":["entiers-32-bits"],"bitcalc":["calculatrice-bit-a-bit"],"keypad-art":["dessin-clavier-numerique"],"zbase32":["code-z-base-32"],"excess3":["code-excess-3"],"zalgo":["obfuscation-diacritiques"],"zwsp":["espace-sans-chasse"],"barcode1d":["code-barres-ean8","code-barres-planet","code-barres-code-postnet"],"base26":["chiffre-base-26"],"base37":["chiffre-base-37"],"fib-coding":["codage-fibonacci"],"negafib-coding":["codage-negafibonacci"],"kaprekar":["algorithme-kaprekar"],"polya":["conjecture-polya"],"tournament":["generateur-tournoi-arbre"],"round-robin":["generateur-championnat"],"americano":["generateur-tournoi-americano"],"life":["jeu-de-la-vie"],"syllogism":["syllogisme"],"random-sample":["echantillon-aleatoire"],"random-digits":["chiffre-aleatoire"],"draw":["tirage-au-sort"],"insee":["code-commune-insee"],"parsons":["code-parsons"],"postal-fr":["code-postal"],"codons":["codons-code-genetique"],"electron-config":["configuration-electronique"],"bounds":["encadrement-mathematique"],"number-sets":["ensembles-nombres"],"knuth":["fleches-knuth"],"san":["notation-san-echecs","notation-echecs"],"uci":["notation-echecs-uci"],"fen":["notation-echecs-fen"],"rpn":["notation-polonaise-inverse"],"chords":["notation-accords-guitare"],"atomic-number":["substitution-numero-atomique"],"barcode-country":["pays-code-barres"],"digit-rank":["rang-chiffre-nombre"],"boolean":["calcul-expressions-booleennes","dual-booleen","table-verite-logique"],"minterms":["calcul-mintermes-maxterms"],"kmap":["table-karnaugh"],"resistor":["code-couleur-resistance"],"capacitor":["code-couleur-condensateur"],"rib":["verification-rib"],"diffie-hellman":["echange-cle-diffie-hellman"],"cipher-identify":["identification-chiffrement"],"caesar-box":["chiffre-carre-de-cesar"],"ubchi":["chiffre-ubchi"],"spiral":["chiffre-spirale"],"transposition-key":["cle-transposition"],"route-path":["ecriture-chemin"],"boustrophedon":["ecriture-boustrophedon"],"mirror-text":["ecriture-speculaire-miroir"],"reverse-text":["ecriture-sens-inverse"],"upside-down":["ecriture-a-l-envers"],"alphagram":["alphagrammes"],"anagram":["generateur-anagrammes"],"anacyclique":["generateur-anacycliques"],"palindrome-gen":["generateur-palindromes"],"javanais":["argot-javanais"],"louchebem":["langage-louchebem"],"pig-latin":["langage-pig-latin"],"tarot":["cartes-tarot"],"playing-cards":["cartes-a-jouer"],"money":["monnaie-pieces-billets"],"scramble-alphabet":["generateur-alphabet-desordonne"]};
const D4_MAP = {"hammingDistance":["distance-hamming"],"levenshtein":["distance-levenshtein"],"regexTool":["recherche-regexp","remplacement-regexp"],"dcode-extras-2026-10/num-sevenseg":["afficheur-7-segments"],"crockford32":["code-base-32-crockford"],"base32":["code-base-32"],"base58":["chiffre-base-58"],"base100":["code-base100-emoji"],"base65536":["encodage-base65536"],"base85":["code-ascii-85"],"base45":["codage-base45"],"base62":["codage-base62"],"ebcdic":["codage-ebcdic"],"unicodeEscape":["codage-unicode","echappement-unicode"],"barcodeGen":["code-barres-aztec","code-barres-code-39","code-barres-code-128","code-barres"],"asciiRadix":["code-ascii","code-binaire"],"ean13":["code-barres-ean13"],"base64":["code-base-64"],"base91":["code-base-91"],"base92":["codage-base92"],"baudot":["code-baudot"],"bubblebabble":["code-bubble-babble"],"graycode":["code-gray"],"dcode-extras-2026-10/sym-hexagram":["hexagramme"],"qrGen":["code-qr"],"chuckUnary":["code-chuck-norris"],"url":["decodage-url"],"varint":["encodage-leb128"],"wingdings":["police-wingdings"],"punycode":["codage-punycode"],"uuencode":["encodage-uu"],"asciiControl":["caracteres-controle-ascii"],"hammingCode":["hamming-correction-erreur"],"htmlCommentExtract":["commentaires-html"],"zipCommentExtract":["commentaires-zip"],"colorInfo":["couleur-en-nombre"],"hashTypeIdentify":["identification-hash","fonction-hash"],"ntlm":["hash-ntlm"],"hexdump":["dump-hexadecimal"],"radixConvert":["systeme-hexadecimal"],"entropy":["indice-shannon"],"bitReverse":["inversion-ordre-bits"],"binaryComplement":["inversion-bit"],"byteSwap":["convertisseur-boutisme"],"zipBrute":["mot-de-passe-zip"],"negabase":["systeme-negabinaire"],"timestamp":["convertisseur-timestamp"],"filetime":["timestamp-windows"],"elias":["codage-elias-delta","codage-elias-gamma"],"dcode-extras-2026-10/sym-braille-gs8":["code-braille-gs8"],"isbn":["code-livre-isbn"],"chineseNum":["numeration-chinoise"],"dcode-extras-2026-10/num-powers10":["puissances-de-10"],"imageBasic":["canaux-rvb","canaux-image"],"pngChunkList":["chunks-png"],"exifExtract":["donnees-exif"],"bin2img":["image-binaire"],"imageGray":["image-niveaux-gris"],"imageToData":["image-chiffres"],"huffmanCodec":["codage-huffman-compression"],"deflateRawCodec":["compression-deflate"],"gzipCodec":["compression-gzip"],"lzw":["compression-lzw"],"zlibCodec":["compression-zlib"],"rle":["compression-rle"],"bwt":["transformee-burrows-wheeler"],"randomSecure":["nombre-aleatoire"],"braille":["alphabet-braille"],"natoAlphabet":["alphabet-phonetique-otan"],"semaphore":["alphabet-semaphore"],"marineFlags":["code-signal-maritime"],"leetSpeak":["ecriture-1337-leet-speak"],"getAllCasings":["majuscules-minuscules"],"dcode-extras-2026-10/num-tally":["marques-unaires"],"spectrogram":["analyse-spectrale"],"cardanGrille":["grille-cardan"],"adfgvx":["chiffre-adfgvx"],"adfgx":["chiffre-adfgx"],"amsco":["chiffre-amsco"],"doubleTrans":["chiffre-double-transposition"],"railFence":["chiffre-rail-fence"],"redefence":["chiffre-redefence"],"scytale":["chiffre-scytale"],"skipCipher":["chiffre-saut"],"columnar":["chiffre-transposition","chiffre-transposition-colonnes"],"turningGrille":["chiffre-grille-tournante"],"aaencode":["encodage-aaencode"],"blub":["langage-blub"],"brainfuck":["langage-brainfuck"],"keyCode":["code-touches-javascript"],"deadfish":["langage-deadfish"],"jsfuck":["langage-jsfuck"],"lolcode":["langage-lolcode"],"malbolge":["langage-malbolge"],"whitespace":["langage-whitespace"],"ook":["langage-ook"],"spoon":["langage-spoon"],"x509Parse":["certificat-x509"],"rc4":["chiffre-rc4"],"rsa":["chiffre-rsa"],"xor":["chiffre-xor"],"bitRotate":["decalage-circulaire-binaire"],"md5":["hash-md5"],"md4":["hash-md4"],"sha1":["hash-sha1"],"sha256":["hash-sha256"],"sha512":["hash-sha512"],"pbkdf2":["hash-pbkdf2"],"roman":["chiffres-romains"],"dcode-extras-2026-10/num-bengali":["chiffre-bengali"],"dcode-extras-2026-10/num-frenchwords":["ecriture-nombre-lettres","ecriture-mots-nombres"],"dcode-extras-2026-10/num-kaktovik":["numeration-kaktovik"],"dcode-extras-2026-10/num-cistercian":["nombres-cisterciens"],"babylonianNumerals":["nombres-babyloniens"],"egyptianNumerals":["numeration-egyptienne"],"mayaNumerals":["nombres-mayas"],"dcode-extras-2026-10/num-shadok":["numeration-shadok"],"dcode-extras-2026-10/num-soroban":["soroban-boulier"],"morbit":["chiffre-morbit"],"playfair":["chiffre-playfair"],"foursquare":["chiffre-quatre-carres"],"collon":["chiffre-collon"],"bifid":["chiffre-bifide-delastelle"],"pollux":["chiffre-pollux"],"twosquare":["chiffre-deux-carres"],"threeSquare":["chiffre-trois-carres"],"t9Phone":["code-multitap-abc"],"astroSymbols":["symboles-astronomiques"],"bcd":["code-bcd"],"decabit":["code-decabit"],"base36":["chiffre-base-36"],"a1z26":["positions-lettres"],"freqAnalysis":["analyse-frequences","bigrammes","trigrammes"],"icAnalysis":["indice-coincidence"],"kasiskiTest":["test-kasiski"],"luhn":["algorithme-luhn"],"verhoeff":["algorithme-verhoeff"],"crc32":["controle-crc-32"],"iban":["verification-iban"]};
const D4_BLOCK = {"code-barres-code-93":"Code93 条码表未内置；主程序 barcodeGen 不支持该制式","code-barres-codabar":"Codabar 条码表未内置；主程序 barcodeGen 不支持该制式","code-barres-postal-francais":"法国邮政 4 态条码需图像渲染与制式表，未实现","fichier-donnees":"需要生成并下载二进制文件，文本 op 无法承载","keysmash-clavier":"键盘乱敲无确定可逆算法，dCode 为站内随机生成器","langue-ithkuil":"Ithkuil 为构造语言词典，非确定性编码","marquage-alpha-angle":"dCode 专有角度标记图，缺少可核实的算法表","notation-laban":"Laban 舞谱为图形记谱，非文本算法","notation-noeuds":"结理论记谱需要图形/多项式计算，未实现","canaux-cmjn":"需要栅格图像通道分离；主程序 imageBasic 仅支持 RGB 通道","canaux-tsl":"需要栅格图像 TSL/HSL 通道分离，主程序未提供","drapeaux":"需要国旗图像数据集与识别","histogramme-image":"需要读取栅格像素并统计直方图","format-cpbitmap":"Apple CPBitmap 为二进制图像格式，未实现","image-pixels-aleatoires":"需要生成随机像素栅格图像","lecture-pixel-image":"需要读取栅格图像像素","miniature-exif":"需要从 EXIF 中提取内嵌缩略图二进制","ocr-reconnaissance-de-caracteres-texte":"需要 OCR 模型","a-propos":"dCode 站点说明页，非算法工具","application-mobile":"dCode 站点应用页，非算法工具","liste-outils":"dCode 站点工具索引页，非算法工具","fr":"dCode 站点首页，非算法工具","#f0":"dCode 站点 FAQ 锚点，非算法工具","#q1":"dCode 站点 FAQ 锚点，非算法工具","#q2":"dCode 站点 FAQ 锚点，非算法工具","#q3":"dCode 站点 FAQ 锚点，非算法工具","#q4":"dCode 站点 FAQ 锚点，非算法工具","#q5":"dCode 站点 FAQ 锚点，非算法工具","chiffrements-moyen-age":"dCode 专题介绍页，非单一算法","chiffrements-multi-couches":"dCode 专题介绍页，非单一算法","solveur-wordament":"需要完整词典与棋盘求解，未实现","webscr?cmd=_s-xclick&hosted_button_id=S53H3S52HJH6N&source=url":"外部支付链接，非工具","javascript:;":"站点占位链接，非工具","AT9V5Vq":"外部 Discord 邀请链接，非工具","":"外部站点/空链接，非工具","generateur-championnat-paires":"双人搭档轮转赛制格式未实现","accent-allemand":"语言口音/发音参考页，无确定性编解码","accent-anglais":"语言口音/发音参考页，无确定性编解码","accent-asiatique":"语言口音/发音参考页，无确定性编解码","accent-hispanique":"语言口音/发音参考页，无确定性编解码","accent-etranger":"语言口音/发音参考页，无确定性编解码","accent-francais":"语言口音/发音参考页，无确定性编解码","accent-italien":"语言口音/发音参考页，无确定性编解码","accent-russe":"语言口音/发音参考页，无确定性编解码","code-chappe":"Chappe 光电报码表未内置","ecriture-dotsies":"Dotsies 字体映射未内置","langage-iokharique":"Iokharic 虚构文字表未内置","langue-des-signes-americaine":"需要手语图像/视频","langue-des-signes-francaise":"需要手语图像/视频","charabia-latin":"dCode 专有 Latin 黑话，无确定算法","chiffre-friderici-fenetres":"历史栅格密码，缺少可核实表","chiffrement-dissimulation":"隐写技术综述，非单一算法","chiffre-trevanion":"历史密码，缺少可核实算法表","binaire-forme-caractere":"需要字符点阵字形数据","chiffre-traits-lettre":"需要手写笔画分割/图像","chiffre-swagman":"Swagman 变体算法未核实","sculpture-kryptos":"Kryptos 为特定雕塑，密钥/分段未完整公开","langage-alphuck":"Alphuck 指令表未在仓库内核实，拒绝猜测","langage-binaryfuck":"Binaryfuck 指令表未在仓库内核实，拒绝猜测","desobfuscateur-javascript":"需要 JS 解析/执行环境，安全边界外","langage-hodor":"Hodor 标点指令表未在仓库内核实，拒绝猜测","langage-pikalang":"Pikalang 指令表未在仓库内核实，拒绝猜测","langage-reversefuck":"ReverseFuck 语义未核实","shakespeare-langage-programmation":"Shakespeare 完整解释器未实现","fonction-hachage-crypt":"Unix crypt(3) 各变体依赖平台库，未实现","numeration-dni":"D'ni 数字字形表未内置","chiffre-digrafide":"Digrafid 多码组算法未实现","chiffre-mccormick":"McCormick 历史密码缺少可核实表","echelle-monoyer":"视力表图像/字体，非算法","echelle-snellen":"视力表图像/字体，非算法","editeur-html":"HTML 编辑器 UI，非算法","editeur-javascript":"JavaScript 编辑器 UI，非算法","4-quatre-elements":"dCode 专有四元素编码，缺少可核实表","code-geek":"Geek Code 文本块格式，未实现","lspk90-h-leet-speak-90-degres-horaire":"旋转 90° 字形，需图像/字体映射"};

const D4_IMPL_BY_SLUG = {};
for (const [op, slugs] of Object.entries(D4_IMPL)) for (const s of slugs) D4_IMPL_BY_SLUG[s] = op;
const D4_MAP_BY_SLUG = {};
for (const [op, slugs] of Object.entries(D4_MAP)) for (const s of slugs) D4_MAP_BY_SLUG[s] = op;

export const COVERAGE = D4_TOOL_ROWS.split("\n").map((line) => {
  const [ci, name, slug, url] = line.split("\t");
  const cat = D4_CATS[Number(ci)];
  const entry = { cat, name: name || slug, slug, url };
  if (D4_IMPL_BY_SLUG[slug]) return { ...entry, status: "implemented", op: NS + "d4-" + D4_IMPL_BY_SLUG[slug] };
  if (D4_MAP_BY_SLUG[slug]) return { ...entry, status: "mapped", target: D4_MAP_BY_SLUG[slug] };
  if (D4_BLOCK[slug]) return { ...entry, status: "blocked", reason: D4_BLOCK[slug] };
  throw new Error("D4 覆盖台账缺少分类: " + slug);
});

export const COVERAGE_STATS = (() => {
  const byStatus = { implemented: 0, mapped: 0, blocked: 0 };
  const byCat = {};
  const uniq = { implemented: new Set(), mapped: new Set(), blocked: new Set() };
  for (const e of COVERAGE) {
    byStatus[e.status]++;
    byCat[e.cat] = byCat[e.cat] || { implemented: 0, mapped: 0, blocked: 0, total: 0 };
    byCat[e.cat][e.status]++;
    byCat[e.cat].total++;
    uniq[e.status].add(e.slug);
  }
  return { entries: COVERAGE.length, byStatus, byCat, unique: { implemented: uniq.implemented.size, mapped: uniq.mapped.size, blocked: uniq.blocked.size } };
})();
