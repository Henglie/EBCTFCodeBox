/*
 * dcode-extras · 文本补遗批（2026-10 · Agent A）
 * 英文数词、命名风格、回文/异形词/全字母句、换行、Rövarspråket、Ubbi Dubbi。
 */

import { big, runOp } from "../lib/util.js";

const CAT = "dcode-extras-2026-10/cat-text";
const P = (key, label, ph) => ({ key, label, type: "text", default: "", placeholder: ph || "" });
const SEL = (key, label, def, opts) => ({ key, label, type: "select", default: def, options: opts.map((o) => (typeof o === "string" ? { value: o, label: o } : o)) });

const ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const SCALES = [[10n ** 12n, "trillion"], [10n ** 9n, "billion"], [10n ** 6n, "million"], [10n ** 3n, "thousand"]];

function under100(n) {
  if (n < 20) return ONES[n];
  return TENS[Math.floor(n / 10)] + (n % 10 ? "-" + ONES[n % 10] : "");
}

function under1000(n) {
  if (n < 100) return under100(n);
  const h = Math.floor(n / 100), r = n % 100;
  return ONES[h] + " hundred" + (r ? " " + under100(r) : "");
}

function toEnglishWords(n) {
  if (n === 0n) return "zero";
  const neg = n < 0n;
  let x = neg ? -n : n;
  if (x >= 10n ** 15n) throw new Error("数值需小于 10^15（本 op 只到 trillion）");
  const parts = [];
  for (const [unit, name] of SCALES) {
    const q = x / unit;
    x %= unit;
    if (q > 0n) parts.push(`${under1000(Number(q))} ${name}`);
  }
  if (x > 0n) parts.push(under1000(Number(x)));
  return (neg ? "minus " : "") + parts.join(" ");
}

const SMALL_WORDS = new Map(ONES.map((w, i) => [w, BigInt(i)]));
for (let t = 2; t < 10; t++) SMALL_WORDS.set(TENS[t], BigInt(t * 10));
const SCALE_WORDS = new Map(SCALES.map(([v, w]) => [w, v]));

function fromEnglishWords(src) {
  const text = String(src).toLowerCase().replace(/[’']/g, "").replace(/-/g, " ").replace(/,/g, " ");
  const toks = text.split(/\s+/).filter(Boolean);
  if (!toks.length) throw new Error("需要英文数词");
  let total = 0n, current = 0n, sign = 1n, saw = false;
  for (const tok of toks) {
    if (tok === "and") continue;
    if (tok === "minus" || tok === "negative") { sign = -1n; continue; }
    if (SMALL_WORDS.has(tok)) { current += SMALL_WORDS.get(tok); saw = true; continue; }
    if (tok === "hundred") { current = (current || 1n) * 100n; saw = true; continue; }
    if (SCALE_WORDS.has(tok)) { total += (current || 1n) * SCALE_WORDS.get(tok); current = 0n; saw = true; continue; }
    throw new Error(`无法识别的英文数词「${tok}」`);
  }
  if (!saw) throw new Error("没有解析到数词");
  return (sign * (total + current)).toString();
}

function splitWords(src) {
  return String(src)
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_./\\-]+/g, " ")
    .match(/[\p{L}\p{N}]+/gu) || [];
}

function normalizeText(s) {
  return String(s).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

function isVowel(ch) {
  return /[aeiou]/i.test(ch);
}

export const OPS = [
  {
    id: "dcode-extras-2026-10/txt-numwords-en", cat: CAT,
    name: "英文数词（Numbers to Words）",
    desc: "整数 ↔ 英文数词（美式短级制，无 and：123 = one hundred twenty-three；10^15 以下）；encode=数字→词，decode=词→数字，可逆",
    params: [{ key: "dir", label: "方向", type: "select", default: "to", options: [{ value: "to", label: "数字→英文" }, { value: "from", label: "英文→数字" }] }],
    encode(text) { return toEnglishWords(big(text) ?? (() => { throw new Error("需要整数"); })()); },
    decode(text) { return fromEnglishWords(text); },
  },

  runOp("dcode-extras-2026-10/txt-casestyle", CAT, "命名风格转换（camel/snake/kebab…）", "按词切分后输出 camelCase、PascalCase、snake_case、kebab-case、CONSTANT_CASE、Title Case、dot.case、path/case",
    (t, p) => {
      const mode = String((p && p.mode) || "camel");
      const words = splitWords(t).map((w) => w.toLowerCase());
      if (!words.length) throw new Error("需要至少一个词");
      const cap = (w) => w ? w[0].toUpperCase() + w.slice(1) : w;
      if (mode === "camel") return words[0] + words.slice(1).map(cap).join("");
      if (mode === "pascal") return words.map(cap).join("");
      if (mode === "snake") return words.join("_");
      if (mode === "kebab") return words.join("-");
      if (mode === "constant") return words.join("_").toUpperCase();
      if (mode === "title") return words.map(cap).join(" ");
      if (mode === "dot") return words.join(".");
      if (mode === "path") return words.join("/");
      throw new Error(`未知模式 ${mode}`);
    }, [SEL("mode", "风格", "camel", [{ value: "camel", label: "camelCase" }, { value: "pascal", label: "PascalCase" }, { value: "snake", label: "snake_case" }, { value: "kebab", label: "kebab-case" }, { value: "constant", label: "CONSTANT_CASE" }, { value: "title", label: "Title Case" }, { value: "dot", label: "dot.case" }, { value: "path", label: "path/case" }])]),

  runOp("dcode-extras-2026-10/txt-palindrome", CAT, "回文 / 异形词 / 全字母句检测", "忽略大小写、重音与标点后判定回文；异形词（字母不重复）；全字母句（覆盖 a-z 26 字母）",
    (t) => {
      const s = String(t);
      const norm = normalizeText(s);
      if (!norm) throw new Error("需要含字母或数字的文本");
      const chars = [...norm];
      const rev = chars.slice().reverse().join("");
      const letters = [...s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()].filter((c) => /\p{L}/u.test(c));
      const uniq = new Set(letters);
      const az = new Set([...s.toLowerCase()].filter((c) => c >= "a" && c <= "z"));
      return [
        `规范化长度 = ${chars.length}`,
        `回文：${chars.join("") === rev ? "是" : "否"}`,
        `异形词（无重复字母）：${uniq.size === letters.length ? "是" : "否"}（唯一字母 ${uniq.size} / 总字母 ${letters.length}）`,
        `全字母句：${az.size === 26 ? "是" : "否"}（覆盖 a-z ${az.size}/26）`,
      ].join("\n");
    }),

  runOp("dcode-extras-2026-10/txt-wordwrap", CAT, "按宽度换行（Word Wrap）", "按指定宽度折行；默认按词折行，超长词可强制硬切；保留原段落空行",
    (t, p) => {
      const width = Number((p && p.width) || 40) || 40;
      const hard = String((p && p.hard) || "oui") === "oui";
      if (!Number.isInteger(width) || width < 2 || width > 200) throw new Error("宽度需为 2..200");
      const out = [];
      for (const line of String(t).replace(/\r/g, "").split("\n")) {
        if (!line) { out.push(""); continue; }
        let cur = "";
        for (const word of line.split(/\s+/).filter(Boolean)) {
          if (word.length > width) {
            if (!hard) throw new Error(`词「${word}」长度超过宽度 ${width}（可开启硬切）`);
            if (cur) { out.push(cur); cur = ""; }
            for (let i = 0; i < word.length; i += width) out.push(word.slice(i, i + width));
            continue;
          }
          if (!cur) cur = word;
          else if (cur.length + 1 + word.length <= width) cur += " " + word;
          else { out.push(cur); cur = word; }
        }
        if (cur) out.push(cur);
      }
      return out.join("\n");
    }, [P("width", "宽度", "40"), SEL("hard", "超长词硬切", "oui", [{ value: "oui", label: "允许" }, { value: "non", label: "报错" }])]),

  {
    id: "dcode-extras-2026-10/txt-rovar", cat: CAT,
    name: "Rövarspråket（强盗语言）",
    desc: "瑞典儿童黑话：每个辅音重复并在中间加 o（hello → hohelollolo）；encode=编码，decode=还原；原词含「辅音-o-同辅音」时存在歧义，已在说明标注",
    params: [],
    encode(text) {
      let out = "";
      for (const ch of String(text)) out += /[b-df-hj-np-tv-z]/i.test(ch) ? ch + "o" + ch : ch;
      return out;
    },
    decode(text) {
      const s = String(text);
      let out = "", i = 0;
      while (i < s.length) {
        const ch = s[i];
        if (/[b-df-hj-np-tv-z]/i.test(ch) && s[i + 1] && s[i + 1].toLowerCase() === "o" && s[i + 2] === ch) {
          out += ch; i += 3;
        } else { out += ch; i++; }
      }
      return out;
    },
  },

  {
    id: "dcode-extras-2026-10/txt-ubbi", cat: CAT,
    name: "Ubbi Dubbi（儿童黑话）",
    desc: "在每个元音簇前加 ub（hello → hubellubo，book → bubook）；encode=编码，decode=还原；原词含「ub+元音」时存在歧义，已在说明标注",
    params: [],
    encode(text) {
      return String(text).replace(/[aeiou]+/gi, (m) => (m[0] === m[0].toUpperCase() ? "Ub" : "ub") + m);
    },
    decode(text) {
      const s = String(text);
      let out = "", i = 0;
      while (i < s.length) {
        const two = s.slice(i, i + 2).toLowerCase();
        if (two === "ub" && s[i + 2] && isVowel(s[i + 2])) { i += 2; continue; }
        out += s[i]; i++;
      }
      return out;
    },
  },
];
