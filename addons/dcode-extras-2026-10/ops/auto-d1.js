import { A26, big, factorizeBounded, makeMapOp, runOp } from "../lib/util.js";

const CAT_SYM = "dcode-extras-2026-10/cat-symbol";
const CAT_CIPHER = "dcode-extras-2026-10/cat-cipher";
const CAT_TEXT = "dcode-extras-2026-10/cat-text";
const P = (key, label, ph) => ({ key, label, type: "text", default: "", placeholder: ph || "" });
const SEL = (key, label, def, opts) => ({ key, label, type: "select", default: def, options: opts.map((o) => (typeof o === "string" ? { value: o, label: o } : o)) });
const BOOL = (key, label, def) => ({ key, label, type: "bool", default: def });
const A = A26;
const idx = (c) => A.indexOf(c);
const letters = (s) => String(s).toUpperCase().replace(/[^A-Z]/g, "");
const escRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function intParam(v, name, min, max) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${name} 需要 ${min}..${max} 的整数`);
  return n;
}

const PF_PRIMES = [];
for (let n = 2; PF_PRIMES.length < 26; n++) {
  let ok = true;
  for (let d = 2; d * d <= n; d++) if (n % d === 0) { ok = false; break; }
  if (ok) PF_PRIMES.push(n);
}

function playfairTable(key) {
  const raw = letters(key).replace(/J/g, "I") + A.replace(/J/g, "");
  return [...new Set(raw.split(""))].slice(0, 25);
}

function playfairPositions(table) {
  const pos = new Map();
  table.forEach((c, i) => pos.set(c, [Math.floor(i / 5), i % 5]));
  return pos;
}

function playfairClean(s) {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "X" && i > 0 && i + 1 < s.length && s[i - 1] === s[i + 1]) continue;
    out += s[i];
  }
  if (out.endsWith("X")) out = out.slice(0, -1);
  return out;
}

function playfairEncode(text, key) {
  const t = playfairTable(key);
  const pos = playfairPositions(t);
  const s = letters(text).replace(/J/g, "I");
  const pairs = [];
  for (let i = 0; i < s.length;) {
    const a = s[i], b = s[i + 1];
    if (b === undefined) { pairs.push([a, "X"]); break; }
    if (a === b) { pairs.push([a, "X"]); i++; continue; }
    pairs.push([a, b]);
    i += 2;
  }
  let out = "";
  for (const [a, b] of pairs) {
    const [ra, ca] = pos.get(a), [rb, cb] = pos.get(b);
    if (ra === rb) out += t[ra * 5 + (ca + 1) % 5] + t[rb * 5 + (cb + 1) % 5];
    else if (ca === cb) out += t[((ra + 1) % 5) * 5 + ca] + t[((rb + 1) % 5) * 5 + cb];
    else out += t[ra * 5 + cb] + t[rb * 5 + ca];
  }
  return out;
}

function playfairDecode(text, key, cleanup) {
  const t = playfairTable(key);
  const pos = playfairPositions(t);
  const s = letters(text).replace(/J/g, "I");
  if (s.length % 2 !== 0) throw new Error("Playfair 密文长度必须为偶数");
  let out = "";
  for (let i = 0; i < s.length; i += 2) {
    const a = s[i], b = s[i + 1];
    const [ra, ca] = pos.get(a), [rb, cb] = pos.get(b);
    if (ra === rb) out += t[ra * 5 + (ca + 4) % 5] + t[rb * 5 + (cb + 4) % 5];
    else if (ca === cb) out += t[((ra + 4) % 5) * 5 + ca] + t[((rb + 4) % 5) * 5 + cb];
    else out += t[ra * 5 + cb] + t[rb * 5 + ca];
  }
  return cleanup ? playfairClean(out) : out;
}

const playfairOp = {
  id: "d1-playfair", cat: CAT_CIPHER,
  name: "Playfair 双字母方阵",
  desc: "标准 5×5 Playfair（I/J 合并，关键字去重）；encode 自动补 X、同字母间插 X；decode 可清理填充 X。已知向量：MONARCHY + HELLO → CFSUPM",
  params: [P("key", "关键字", "MONARCHY"), BOOL("cleanup", "解密后清理填充 X", true)],
  encode(text, p) { return playfairEncode(text, (p && p.key) || "MONARCHY"); },
  decode(text, p) { return playfairDecode(text, (p && p.key) || "MONARCHY", (p && p.cleanup) !== false); },
};

const ALBHED_TABLE = {
  A: "Y", B: "P", C: "L", D: "T", E: "A", F: "V", G: "K", H: "R", I: "E", J: "Z",
  K: "G", L: "M", M: "S", N: "H", O: "U", P: "B", Q: "X", R: "N", S: "C", T: "D",
  U: "I", V: "J", W: "F", X: "Q", Y: "O", Z: "W",
};

const albhedOp = makeMapOp({
  id: "d1-albhed", cat: CAT_SYM,
  name: "Al Bhed 字母表（最终幻想 X）",
  desc: "拉丁字母 ↔ Al Bhed 26 字母替换（FFX 官方表）；HELLO → RAMMU。大小写不敏感，非字母透传",
  table: ALBHED_TABLE,
});

const CLAW_SUB = {
  A: "B", B: "C", C: "D", D: "F", E: "E", F: "H", G: "G", H: "I", I: "J", J: "K",
  K: "L", L: "M", M: "N", N: "P", O: "O", P: "Q", Q: "S", R: "R", S: "T", T: "U",
  U: "V", V: "W", W: "X", X: "Y", Y: "Z", Z: "A",
};
const CLAW_SUB_INV = Object.fromEntries(Object.entries(CLAW_SUB).map(([k, v]) => [v, k]));
const CLAW_MARK = {
  A: "|", B: "|\\", C: "||", D: "|/", E: "\\", F: "||\\", G: "|||", H: "||/", I: "/",
  J: "|\\\\", K: "|\\|", L: "|\\/", M: "|/\\", N: "|/|", O: "|//", P: "\\\\",
  Q: "\\|", R: "\\/", S: "/\\", T: "/|", U: "//", V: "||\\\\", W: "||//",
  X: "|||\\", Y: "|||/", Z: "||||",
};
const CLAW_MARK_INV = Object.fromEntries(Object.entries(CLAW_MARK).map(([k, v]) => [v, k]));

function clawLetters(text, dec) {
  const table = dec ? CLAW_SUB_INV : CLAW_SUB;
  let out = "";
  for (const ch of String(text).toUpperCase()) out += table[ch] || ch;
  return out;
}

function clawMarks(text, dec) {
  if (dec) {
    const toks = String(text).trim().split(/\s+/).filter(Boolean);
    let out = "";
    for (const t of toks) {
      const k = CLAW_MARK_INV[t];
      if (k === undefined) throw new Error(`爪痕记号「${t}」非法`);
      out += k;
    }
    return out;
  }
  const toks = [];
  for (const ch of String(text).toUpperCase()) {
    if (CLAW_MARK[ch]) toks.push(CLAW_MARK[ch]);
    else if (/\s/.test(ch)) toks.push("");
    else throw new Error(`字符「${ch}」不是 A-Z`);
  }
  return toks.join(" ").replace(/\s+/g, " ").trim();
}

const codeClawOp = {
  id: "d1-code-claw", cat: CAT_SYM,
  name: "Gregor 爪痕密码（Code of Claw）",
  desc: "G/O/R/E 固定，其余字母后移一位（跳过固定字母）；claw 档再映射为 | / \\ 爪痕表。RAT → RBU；RBU → \\/ |\\ //",
  params: [SEL("mode", "模式", "letters", [{ value: "letters", label: "字母替换" }, { value: "claw", label: "爪痕符号" }])],
  encode(text, p) {
    const s = clawLetters(text, false);
    return (p && p.mode) === "claw" ? clawMarks(s, false) : s;
  },
  decode(text, p) {
    const s = (p && p.mode) === "claw" ? clawMarks(text, true) : String(text).toUpperCase();
    return clawLetters(s, true);
  },
};

function rankValue(i, anchorIndex, anchorValue, scheme) {
  let v;
  if (scheme === "cyclic") {
    v = ((i - anchorIndex) % 26 + 26) % 26 + anchorValue;
    while (v > 26) v -= 26;
  } else if (scheme === "zero") {
    v = i - anchorIndex + anchorValue;
  } else if (scheme === "reverse") {
    v = ((anchorIndex - i) % 26 + 26) % 26 + anchorValue;
    while (v > 26) v -= 26;
  } else if (scheme === "reverseZero") {
    v = anchorIndex - i + anchorValue;
  } else {
    throw new Error("scheme 需为 cyclic/zero/reverse/reverseZero");
  }
  return v;
}

function rankMaps(anchor, anchorValue, scheme) {
  const ai = idx(anchor);
  if (ai < 0) throw new Error("anchor 需为 A-Z 单字母");
  const rev = new Map();
  for (let i = 0; i < 26; i++) {
    const v = rankValue(i, ai, anchorValue, scheme);
    if (rev.has(v)) throw new Error(`秩映射冲突：${A[i]} 与 ${rev.get(v)} 都映射到 ${v}`);
    rev.set(v, A[i]);
  }
  return { ai, rev };
}

function rankEncode(text, anchor, anchorValue, scheme, sep) {
  const { ai } = rankMaps(anchor, anchorValue, scheme);
  const out = [];
  for (const ch of String(text).toUpperCase()) {
    const i = idx(ch);
    out.push(i < 0 ? ch : String(rankValue(i, ai, anchorValue, scheme)));
  }
  return out.join(sep).replace(/\s+/g, " ").trim();
}

function rankDecode(text, anchor, anchorValue, scheme, sep) {
  const { rev } = rankMaps(anchor, anchorValue, scheme);
  const pat = new RegExp(`${escRe(sep)}|\\s+`, "g");
  const toks = String(text).split(pat).filter((x) => x !== "");
  const out = [];
  for (const t of toks) {
    if (/^-?\d+$/.test(t)) {
      const c = rev.get(Number(t));
      if (c === undefined) throw new Error(`数值 ${t} 不在 ${anchor}=${anchorValue} 的 ${scheme} 映射内`);
      out.push(c);
    } else {
      out.push(t);
    }
  }
  return out.join("");
}

const rankAnchorOp = {
  id: "d1-rank-anchor", cat: CAT_SYM,
  name: "锚定字母秩密码（D3 / K7 / K6 / Indienne）",
  desc: "A1Z26 变体：anchor 字母固定为 value，其余按 cyclic（1-26 循环）、zero（可为负）、reverse（反向）、reverseZero 排列。D3：DCODE→3/2/14/3/4；K7：DCODE→26/25/11/26/1；K6：DCODE→25/24/10/25/26；Indienne N=1：DCODE→17/16/2/17/18",
  params: [
    P("anchor", "锚定字母", "D"),
    P("value", "锚定值", "3"),
    SEL("scheme", "编号法", "cyclic", [{ value: "cyclic", label: "循环 1-26" }, { value: "zero", label: "零基/可负" }, { value: "reverse", label: "反向循环" }, { value: "reverseZero", label: "反向零基/可负" }]),
    P("sep", "分隔符", "/"),
  ],
  encode(text, p) {
    return rankEncode(text, String((p && p.anchor) || "D").toUpperCase(), intParam((p && p.value) || 3, "value", 1, 26), (p && p.scheme) || "cyclic", (p && p.sep) || "/");
  },
  decode(text, p) {
    return rankDecode(text, String((p && p.anchor) || "D").toUpperCase(), intParam((p && p.value) || 3, "value", 1, 26), (p && p.scheme) || "cyclic", (p && p.sep) || "/");
  },
};

const GREEK_UPPER = "ΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩ";
const GREEK_LOWER = "αβγδεζηθικλμνξοπρστυφχψω";

function greekRankEncode(text) {
  const out = [];
  for (const ch of String(text)) {
    let i = GREEK_UPPER.indexOf(ch);
    if (i < 0) i = GREEK_LOWER.indexOf(ch);
    if (i < 0 && ch === "ς") i = 17;
    if (i < 0) { out.push(ch); continue; }
    out.push(String(i + 1));
  }
  return out.join(" ").replace(/\s+/g, " ").trim();
}

function greekRankDecode(text) {
  const toks = String(text).trim().split(/[\s,;]+/).filter(Boolean);
  const out = [];
  for (const t of toks) {
    if (/^\d+$/.test(t)) {
      const n = Number(t);
      if (n < 1 || n > 24) throw new Error(`希腊字母秩需 1..24（收到 ${t}）`);
      out.push(GREEK_LOWER[n - 1]);
    } else {
      out.push(t);
    }
  }
  return out.join("");
}

const greekRankOp = {
  id: "d1-greek-rank", cat: CAT_SYM,
  name: "希腊字母秩 α=1, β=2",
  desc: "24 个希腊字母按 Α..Ω 编号 1..24（词尾 ς 同 Σ=18）；αβγ → 1 2 3，Ω → 24",
  params: [],
  encode: greekRankEncode,
  decode: greekRankDecode,
};

function alphaSumEncode(text, first) {
  let total = 0;
  const out = [];
  for (const ch of String(text).toUpperCase()) {
    const i = idx(ch);
    if (i < 0) { out.push(ch); continue; }
    total += i + (first ? 1 : 0);
    out.push(String(total));
  }
  return out.join(" ").replace(/\s+/g, " ").trim();
}

function alphaSumDecode(text, first) {
  const toks = String(text).trim().split(/[\s,;]+/).filter(Boolean);
  const out = [];
  let prev = 0;
  for (const t of toks) {
    if (/^-?\d+$/.test(t)) {
      const n = Number(t);
      const rank = n - prev;
      prev = n;
      const i = first ? rank - 1 : rank;
      if (i < 0 || i > 25) throw new Error(`差分 ${rank} 超出字母秩范围（检查 first=${first ? 1 : 0} 或分隔）`);
      out.push(A[i]);
    } else {
      out.push(t);
    }
  }
  return out.join("");
}

const alphaSumOp = {
  id: "d1-alpha-sum", cat: CAT_SYM,
  name: "秩累加密码（A1Z26 Additionné）",
  desc: "每字母的 A1Z26 秩累加到前一项：ABC → 1/3/6，DCODE → 4/7/22/26/31；first=1 或 0 控制首字母基数。解密逐项作差",
  params: [SEL("first", "首字母值", "1", [{ value: "1", label: "1（A=1）" }, { value: "0", label: "0（A=0）" }])],
  encode(text, p) { return alphaSumEncode(text, String((p && p.first) || "1") !== "0"); },
  decode(text, p) { return alphaSumDecode(text, String((p && p.first) || "1") !== "0"); },
};

const VOWELS = "AEIOUY";
const CONSONANTS = "BCDFGHJKLMNPQRSTVWXZ";

function cvEncode(text, mode) {
  const out = [];
  for (const ch of String(text).toUpperCase()) {
    const isV = VOWELS.includes(ch);
    const isC = CONSONANTS.includes(ch);
    if (mode === "both" && (isV || isC)) out.push((isV ? "V" : "C") + ((isV ? VOWELS : CONSONANTS).indexOf(ch) + 1));
    else if (mode === "consonants" && isC) out.push(String(CONSONANTS.indexOf(ch) + 1));
    else if (mode === "vowels" && isV) out.push(String(VOWELS.indexOf(ch) + 1));
    else out.push(ch);
  }
  return mode === "both" ? out.join("") : out.join(" ");
}

function cvDecode(text, mode) {
  const s = String(text).toUpperCase();
  if (mode === "both") {
    let out = "";
    for (let i = 0; i < s.length;) {
      const m = /^[CV]\d+/.exec(s.slice(i));
      if (m) {
        const n = Number(m[0].slice(1));
        const list = m[0][0] === "V" ? VOWELS : CONSONANTS;
        if (n < 1 || n > list.length) throw new Error(`秩 ${n} 超出 ${m[0][0]} 范围`);
        out += list[n - 1];
        i += m[0].length;
      } else {
        out += s[i++];
      }
    }
    return out;
  }
  const toks = s.trim().split(/\s+/).filter(Boolean);
  const out = [];
  for (const t of toks) {
    if (/^\d+$/.test(t)) {
      const n = Number(t);
      const list = mode === "vowels" ? VOWELS : CONSONANTS;
      if (n < 1 || n > list.length) throw new Error(`秩 ${n} 超出范围`);
      out.push(list[n - 1]);
    } else {
      out.push(t);
    }
  }
  return out.join("");
}

const cvRankOp = {
  id: "d1-cv-rank", cat: CAT_SYM,
  name: "辅音/元音秩密码",
  desc: "元音 AEIOUY 编 1..6，辅音 BCDFGHJKLMNPQRSTVWXZ 编 1..20。both：DCODE→C3C2V4C3V2；consonants：3 2 O 3 E；vowels：D C 4 D 2",
  params: [SEL("mode", "模式", "both", [{ value: "both", label: "辅音 C 与元音 V" }, { value: "consonants", label: "仅辅音" }, { value: "vowels", label: "仅元音" }])],
  encode(text, p) { return cvEncode(text, (p && p.mode) || "both"); },
  decode(text, p) { return cvDecode(text, (p && p.mode) || "both"); },
};

function primeSubstEncode(text) {
  const out = [];
  for (const ch of String(text).toUpperCase()) {
    const i = idx(ch);
    out.push(i < 0 ? ch : String(PF_PRIMES[i]));
  }
  return out.join(" ").replace(/\s+/g, " ").trim();
}

function primeSubstDecode(text) {
  const toks = String(text).trim().split(/[\s,;]+/).filter(Boolean);
  const out = [];
  for (const t of toks) {
    if (/^\d+$/.test(t)) {
      const i = PF_PRIMES.indexOf(Number(t));
      if (i < 0) throw new Error(`${t} 不是 A-Z 对应的前 26 个素数之一`);
      out.push(A[i]);
    } else {
      out.push(t);
    }
  }
  return out.join("");
}

const primeSubstOp = {
  id: "d1-prime-subst", cat: CAT_SYM,
  name: "素数替换（A=2, B=3, … Z=101）",
  desc: "字母 ↔ 第 n 个素数：A=2, B=3, C=5, … Z=101；ABC → 2 3 5。decode 只接受前 26 个素数",
  params: [],
  encode: primeSubstEncode,
  decode: primeSubstDecode,
};

function primeMultEncode(text, mode) {
  const words = String(text).toUpperCase().match(/[A-Z]+/g) || [];
  if (!words.length) throw new Error("需要至少一个 A-Z 单词");
  return words.map((word) => {
    if (word.length > 26) throw new Error("单词长度不能超过 26（位置素数表上限）");
    let prod = 1n;
    for (let i = 0; i < word.length; i++) {
      const letterPrime = BigInt(PF_PRIMES[idx(word[i])]);
      if (mode === "expPos") prod *= BigInt(PF_PRIMES[i]) ** BigInt(idx(word[i]) + 1);
      else prod *= letterPrime ** BigInt(i + 1);
    }
    return prod.toString();
  }).join(" ");
}

function primeMultDecode(text, mode) {
  const toks = String(text).trim().split(/\s+/).filter(Boolean);
  return toks.map((tok) => {
    const n = big(tok);
    if (n === null || n < 2n) throw new Error(`「${tok}」不是 ≥2 的整数`);
    const f = factorizeBounded(n);
    if (!f.complete) throw new Error(`无法完全分解 ${tok}`);
    if (mode === "expPos") {
      const out = [];
      for (const [p, e] of f.factors) {
        const pos = PF_PRIMES.indexOf(Number(p));
        if (pos < 0) throw new Error(`因子 ${p} 不在前 26 个素数中`);
        if (e < 1 || e > 26) throw new Error(`指数 ${e} 超出 A-Z 秩`);
        if (out[pos] !== undefined) throw new Error(`位置 ${pos + 1} 重复`);
        out[pos] = A[e - 1];
      }
      if (out.some((x) => x === undefined)) throw new Error("指数位置不连续");
      return out.join("");
    }
    const out = [];
    for (const [p, e] of f.factors) {
      const li = PF_PRIMES.indexOf(Number(p));
      if (li < 0) throw new Error(`因子 ${p} 不对应 A-Z`);
      if (e < 1 || e > 52) throw new Error(`指数 ${e} 超出位置范围`);
      if (out[e - 1] !== undefined) throw new Error(`位置 ${e} 重复（重复字母导致指数合并，请拆词）`);
      out[e - 1] = A[li];
    }
    if (out.some((x) => x === undefined)) throw new Error("指数位置不连续（重复字母导致合并，请拆词）");
    return out.join("");
  }).join(" ");
}

const primeMultOp = {
  id: "d1-prime-mult", cat: CAT_CIPHER,
  name: "素数乘法密码（letter^position / position^letter）",
  desc: "expLetter：每个字母的素数按词内位置乘方（AB→2×3²=18）；expPos：第 i 个素数为底、字母秩为指数（DCODE→2⁴×3³×5¹⁵×7⁴×11⁵）。重复字母在 expLetter 下指数合并，需拆词",
  params: [SEL("mode", "模式", "expLetter", [{ value: "expLetter", label: "字母素数^位置" }, { value: "expPos", label: "位置素数^字母秩" }])],
  encode(text, p) { return primeMultEncode(text, (p && p.mode) || "expLetter"); },
  decode(text, p) { return primeMultDecode(text, (p && p.mode) || "expLetter"); },
};

const MIRROR_DIGIT = { 0: "0", 1: "1", 2: "5", 5: "2", 6: "9", 8: "8", 9: "6" };

function mirrorDigits(text) {
  let out = "";
  for (const ch of String(text)) {
    if (/[0-9]/.test(ch)) {
      const v = MIRROR_DIGIT[ch];
      if (v === undefined) throw new Error(`数字 ${ch} 没有镜像字形（仅 0/1/2/5/6/8/9）`);
      out += v;
    } else {
      out += ch;
    }
  }
  return out;
}

const mirrorDigitsOp = {
  id: "d1-mirror-digits", cat: CAT_SYM,
  name: "镜像数字（Chiffres Miroir）",
  desc: "0↔0, 1↔1, 2↔5, 5↔2, 6↔9, 8↔8, 9↔6；3/4/7 无镜像，显式报错。2026 → 5059",
  params: [],
  encode: mirrorDigits,
  decode: mirrorDigits,
};

function asciiShift(text, shift, dir) {
  let out = "";
  for (const ch of String(text)) {
    const cp = ch.codePointAt(0);
    if (cp > 127) throw new Error(`字符「${ch}」不在 ASCII 0..127`);
    const v = ((cp + dir * shift) % 128 + 128) % 128;
    out += String.fromCharCode(v);
  }
  return out;
}

const asciiShiftOp = {
  id: "d1-ascii-shift", cat: CAT_CIPHER,
  name: "ASCII 表移位",
  desc: "每个字符的 ASCII 码加/减固定位移，模 128 循环；A(65)+40 → i(105)。密钥可为正负整数",
  params: [P("shift", "位移", "40")],
  encode(text, p) { return asciiShift(text, intParam((p && p.shift) || 40, "shift", -127, 127), 1); },
  decode(text, p) { return asciiShift(text, intParam((p && p.shift) || 40, "shift", -127, 127), -1); },
};

function progressiveCaesar(text, step, start, dec) {
  let i = 0, out = "";
  for (const ch of String(text).toUpperCase()) {
    const p = idx(ch);
    if (p < 0) { out += ch; continue; }
    const shift = start + step * i;
    out += A[dec ? ((p - shift) % 26 + 26) % 26 : (p + shift) % 26];
    i++;
  }
  return out;
}

const progressiveCaesarOp = {
  id: "d1-progressive-caesar", cat: CAT_CIPHER,
  name: "递进移位（Chiffre par Décalages）",
  desc: "每个字母按 start + step×序号 递增移位；ABC（step=1,start=0）→ ACE，decode 反向逐位减",
  params: [P("step", "步长", "1"), P("start", "起始位移", "0")],
  encode(text, p) { return progressiveCaesar(text, intParam((p && p.step) || 1, "step", -25, 25), intParam((p && p.start) || 0, "start", -25, 25), false); },
  decode(text, p) { return progressiveCaesar(text, intParam((p && p.step) || 1, "step", -25, 25), intParam((p && p.start) || 0, "start", -25, 25), true); },
};

function unicodeShift(text, shift, dir) {
  let out = "";
  for (const ch of String(text)) {
    const cp = ch.codePointAt(0);
    const v = cp + dir * shift;
    if (v < 0 || v > 0x10ffff) throw new Error(`码位 ${cp} ${dir > 0 ? "+" : "-"} ${shift} 超出 Unicode 范围`);
    out += String.fromCodePoint(v);
  }
  return out;
}

const unicodeShiftOp = {
  id: "d1-unicode-shift", cat: CAT_CIPHER,
  name: "Unicode 码位移位",
  desc: "每个码位加/减 N（不取模，越界报错）；dCode +1234 → ԶԕՁԶԷ",
  params: [P("shift", "位移", "1234")],
  encode(text, p) { return unicodeShift(text, intParam((p && p.shift) || 1234, "shift", -0x10ffff, 0x10ffff), 1); },
  decode(text, p) { return unicodeShift(text, intParam((p && p.shift) || 1234, "shift", -0x10ffff, 0x10ffff), -1); },
};

const CTRL_ROWS = [
  ["NUL", 0, "␀"], ["SOH", 1, "␁"], ["STX", 2, "␂"], ["ETX", 3, "␃"], ["EOT", 4, "␄"],
  ["ENQ", 5, "␅"], ["ACK", 6, "␆"], ["BEL", 7, "␇"], ["BS", 8, "␈"], ["HT", 9, "␉"],
  ["LF", 10, "␊"], ["VT", 11, "␋"], ["FF", 12, "␌"], ["CR", 13, "␍"], ["SO", 14, "␎"],
  ["SI", 15, "␏"], ["DLE", 16, "␐"], ["DC1", 17, "␑"], ["DC2", 18, "␒"], ["DC3", 19, "␓"],
  ["DC4", 20, "␔"], ["NAK", 21, "␕"], ["SYN", 22, "␖"], ["ETB", 23, "␗"], ["CAN", 24, "␘"],
  ["EM", 25, "␙"], ["SUB", 26, "␚"], ["ESC", 27, "␛"], ["FS", 28, "␜"], ["GS", 29, "␝"],
  ["RS", 30, "␞"], ["US", 31, "␟"], ["SP", 32, "␠"], ["DEL", 127, "␡"],
];
const CTRL_BY_CODE = new Map(CTRL_ROWS.map(([name, code, sym]) => [code, { name, code, sym }]));
const CTRL_BY_NAME = new Map(CTRL_ROWS.map(([name, code, sym]) => [name, { name, code, sym }]));
const CTRL_BY_SYM = new Map(CTRL_ROWS.map(([name, code, sym]) => [sym, { name, code, sym }]));

function asciiControlsEncode(text, mode) {
  const out = [];
  for (const ch of String(text)) {
    const cp = ch.codePointAt(0);
    const rec = CTRL_BY_CODE.get(cp);
    if (rec && cp !== 32) out.push(mode === "symbol" ? rec.sym : mode === "code" ? String(cp) : rec.name);
    else out.push(ch);
  }
  return out.join(" ").replace(/\s+/g, " ").trim();
}

function asciiControlsDecode(text) {
  const toks = String(text).trim().split(/\s+/).filter(Boolean);
  let out = "";
  for (const t of toks) {
    const rec = CTRL_BY_NAME.get(t.toUpperCase()) || CTRL_BY_SYM.get(t);
    if (rec) { out += String.fromCharCode(rec.code); continue; }
    if (/^\d+$/.test(t)) {
      const n = Number(t);
      const r = CTRL_BY_CODE.get(n);
      if (!r) throw new Error(`ASCII 控制码 ${t} 不在 0..32/127`);
      out += String.fromCharCode(n);
      continue;
    }
    throw new Error(`无法识别控制字符记号「${t}」`);
  }
  return out;
}

const asciiControlsOp = {
  id: "d1-ascii-controls", cat: CAT_TEXT,
  name: "ASCII 控制字符",
  desc: "0..31、32(SP)、127(DEL) ↔ 短名/Unicode 控制图符/十进制码；NUL SOH STX ETX、␀␁␂␃",
  params: [SEL("mode", "输出格式", "name", [{ value: "name", label: "短名" }, { value: "symbol", label: "Unicode 图符" }, { value: "code", label: "十进制码" }])],
  encode(text, p) { return asciiControlsEncode(text, (p && p.mode) || "name"); },
  decode: asciiControlsDecode,
};

function wordPattern(word) {
  const map = new Map();
  let next = 0;
  let out = "";
  for (const ch of letters(word)) {
    if (!map.has(ch)) map.set(ch, String(next++));
    out += map.get(ch);
  }
  return out;
}

const wordPatternOp = {
  id: "d1-word-pattern", cat: CAT_TEXT,
  name: "单词模式/去替换（Motif de Mot）",
  desc: "把单词化为重复结构指纹（BOB→010，DCODE→01234），再在用户候选词表中匹配同指纹词。内置词典不随包分发，候选词由 words 参数提供",
  params: [P("words", "候选词（逗号/换行分隔）", "BOB,EVE,SMS,CAB")],
  encode(text) {
    const ws = String(text).match(/[A-Za-z]+/g) || [];
    if (!ws.length) throw new Error("需要至少一个单词");
    return ws.map(wordPattern).join(" ");
  },
  decode(text, p) {
    const pats = String(text).trim().split(/\s+/).filter(Boolean);
    const pool = String((p && p.words) || "").split(/[\s,;]+/).filter(Boolean);
    if (!pool.length) throw new Error("需要候选词表（words 参数）");
    return pats.map((pat) => {
      const hits = pool.filter((w) => wordPattern(w) === pat);
      return `${pat}: ${hits.length ? hits.join(", ") : "无匹配"}`;
    }).join("\n");
  },
};

const ELEMENTS = [
  ["air", "🜁", ["air", "vent"]],
  ["fire", "🜂", ["fire", "feu"]],
  ["earth", "🜃", ["earth", "terre"]],
  ["water", "🜄", ["water", "eau"]],
];
const ELEMENT_BY_WORD = new Map();
const ELEMENT_BY_SYM = new Map();
for (const [en, sym, words] of ELEMENTS) {
  ELEMENT_BY_SYM.set(sym, en);
  for (const w of words) ELEMENT_BY_WORD.set(w, sym);
}

function fourElementsEncode(text) {
  const toks = String(text).trim().split(/[\s,;]+/).filter(Boolean);
  if (!toks.length) throw new Error("需要元素名（air/fire/earth/water 或 feu/terre/eau/vent）");
  return toks.map((t) => {
    const sym = ELEMENT_BY_WORD.get(t.toLowerCase());
    if (!sym) throw new Error(`未知元素「${t}」`);
    return sym;
  }).join(" ");
}

function fourElementsDecode(text) {
  let out = "";
  for (const ch of String(text)) {
    if (ch === " ") { out += " "; continue; }
    const en = ELEMENT_BY_SYM.get(ch);
    if (!en) throw new Error(`符号「${ch}」不是四元素炼金符号（🜁🜂🜃🜄）`);
    out += en;
  }
  return out.trim();
}

const fourElementsOp = {
  id: "d1-four-elements", cat: CAT_SYM,
  name: "四元素炼金符号",
  desc: "Air 🜁 U+1F701、Fire 🜂 U+1F702、Earth 🜃 U+1F703、Water 🜄 U+1F704；支持英/法元素名",
  params: [],
  encode: fourElementsEncode,
  decode: fourElementsDecode,
};

const ZODIAC_ANIMALS = ["Monkey", "Rooster", "Dog", "Pig", "Rat", "Ox", "Tiger", "Rabbit", "Dragon", "Snake", "Horse", "Goat"];
const ZODIAC_ELEMENTS = ["Metal", "Metal", "Water", "Water", "Wood", "Wood", "Fire", "Fire", "Earth", "Earth"];

function chineseZodiacRun(text, p) {
  const src = String((p && p.year) || text || "").trim();
  if (!src) throw new Error("需要年份或动物名");
  if (/^-?\d+$/.test(src)) {
    const y = Number(src);
    const animal = ZODIAC_ANIMALS[((y % 12) + 12) % 12];
    const element = ZODIAC_ELEMENTS[((y % 10) + 10) % 10];
    return `${y}: ${animal}, ${element}（中国新年 1-2 月边界未细分）`;
  }
  const animal = ZODIAC_ANIMALS.find((a) => a.toLowerCase() === src.toLowerCase());
  if (!animal) throw new Error(`未知生肖「${src}」（${ZODIAC_ANIMALS.join("/")}）`);
  const hits = [];
  for (let y = 1900; y <= 2100; y++) if (ZODIAC_ANIMALS[((y % 12) + 12) % 12] === animal) hits.push(y);
  return `${animal}: ${hits.join(", ")}`;
}

const chineseZodiacOp = runOp(
  "d1-chinese-zodiac", CAT_TEXT,
  "中国生肖/五行（按年）",
  "年 mod 12 定动物（0=Monkey … 8=Dragon），年尾数定五行（0/1 金、2/3 水、4/5 木、6/7 火、8/9 土）；2024 → Dragon, Wood。公历 1-2 月新年边界未细分",
  chineseZodiacRun,
  [P("year", "年份或动物名", "2024")],
);

function wolTable(key, remove) {
  const rep = remove === "J" ? "I" : remove === "V" ? "U" : remove === "W" ? "V" : null;
  let k = letters(key);
  if (rep) k = k.replaceAll(remove, rep);
  const out = [...new Set(k.split(""))];
  for (const c of A) {
    if (rep && c === remove) continue;
    if (!out.includes(c)) out.push(c);
  }
  return out;
}

function wolseley(text, key, remove) {
  const t = wolTable(key, remove);
  const rep = remove === "J" ? "I" : remove === "V" ? "U" : remove === "W" ? "V" : null;
  let out = "";
  for (const ch of String(text).toUpperCase()) {
    const c = rep && ch === remove ? rep : ch;
    const i = t.indexOf(c);
    out += i < 0 ? ch : t[t.length - 1 - i];
  }
  return out;
}

const wolseleyOp = {
  id: "d1-wolseley", cat: CAT_CIPHER,
  name: "Wolseley 可逆替换",
  desc: "关键字生成去重字母表，再按首尾对称替换（自逆）。默认删 J（J→I）的 25 字母原版；SECRET + WOLSELEY → RFIZYIYE",
  params: [P("key", "关键字", "SECRET"), SEL("remove", "删除字母", "J", [{ value: "J", label: "删 J（J→I）" }, { value: "V", label: "删 V（V→U）" }, { value: "W", label: "删 W（W→V）" }, { value: "none", label: "不删（26 字母）" }])],
  encode(text, p) { return wolseley(text, (p && p.key) || "SECRET", (p && p.remove) || "J"); },
  decode(text, p) { return wolseley(text, (p && p.key) || "SECRET", (p && p.remove) || "J"); },
};

function swagGrid(src) {
  const digits = String(src || "1324341221434231").replace(/[^1-9]/g, "");
  const n = Math.round(Math.sqrt(digits.length));
  if (n < 2 || n > 12 || n * n !== digits.length) throw new Error("Swagman 网格需 N×N（N=2..12）数字串");
  const grid = [];
  for (let r = 0; r < n; r++) grid.push(digits.slice(r * n, (r + 1) * n).split("").map(Number));
  for (let r = 0; r < n; r++) {
    if (new Set(grid[r]).size !== n) throw new Error(`Swagman 第 ${r + 1} 行不是 1..${n} 的排列`);
  }
  for (let c = 0; c < n; c++) {
    const col = grid.map((row) => row[c]);
    if (new Set(col).size !== n) throw new Error(`Swagman 第 ${c + 1} 列不是 1..${n} 的排列`);
  }
  return grid;
}

function swagmanEncode(text, gridSrc, pad) {
  const grid = swagGrid(gridSrc);
  const n = grid.length;
  const padChar = String(pad || "X").slice(0, 1) || "X";
  let s = String(text).replace(/\s+/g, "").toUpperCase();
  if (!s) throw new Error("需要非空明文");
  s = s.padEnd(Math.ceil(s.length / n) * n, padChar);
  const rows = [];
  for (let r = 0; r < n; r++) rows.push(s.slice(r * (s.length / n), (r + 1) * (s.length / n)).split(""));
  let out = "";
  for (let c = 0; c < s.length / n; c++) {
    const order = Array.from({ length: n }, (_, r) => r).sort((a, b) => grid[a][c % n] - grid[b][c % n]);
    for (const r of order) out += rows[r][c];
  }
  return out;
}

function swagmanDecode(text, gridSrc, pad, strip) {
  const grid = swagGrid(gridSrc);
  const n = grid.length;
  const s = String(text).replace(/\s+/g, "").toUpperCase();
  if (!s.length || s.length % n !== 0) throw new Error(`Swagman 密文长度需为 ${n} 的倍数`);
  const cols = s.length / n;
  const rows = Array.from({ length: n }, () => new Array(cols));
  for (let c = 0; c < cols; c++) {
    const chunk = s.slice(c * n, (c + 1) * n);
    const order = Array.from({ length: n }, (_, r) => r).sort((a, b) => grid[a][c % n] - grid[b][c % n]);
    order.forEach((r, k) => { rows[r][c] = chunk[k]; });
  }
  let out = rows.map((r) => r.join("")).join("");
  if (strip) out = out.replace(new RegExp(`${escRe(pad || "X")}+$`), "");
  return out;
}

const swagmanOp = {
  id: "d1-swagman", cat: CAT_CIPHER,
  name: "Swagman 拉丁方阵换位",
  desc: "N×N 拉丁方阵关键字逐列按 1..N 顺序读取。默认 4×4 方阵 1324341221434231；DCODESWAGMANCIPHER → DASHNECWAORCXGIDEPMX",
  params: [P("grid", "拉丁方阵（N×N 数字串）", "1324341221434231"), P("pad", "填充字母", "X"), BOOL("strip", "解密后去尾部填充", true)],
  encode(text, p) { return swagmanEncode(text, (p && p.grid) || "1324341221434231", (p && p.pad) || "X"); },
  decode(text, p) { return swagmanDecode(text, (p && p.grid) || "1324341221434231", (p && p.pad) || "X", (p && p.strip) !== false); },
};

const GRANDPRE_DEFAULT = "VOLUPTUEUXINQUIETUDEMAJESTUEUXOBLIGEANCEUNIFORMITETWICKENHAMINGOLSTADTEINSIEDELNRYMKIEWICZSHREWSBURY";

function grandpreGrid(src) {
  const raw = String(src || GRANDPRE_DEFAULT).toUpperCase().replace(/[^A-Z]/g, "");
  if (raw.length !== 100) throw new Error("Grandpré 网格需 100 个字母（10 行×10 列）");
  const rows = [];
  for (let r = 0; r < 10; r++) rows.push(raw.slice(r * 10, (r + 1) * 10));
  return rows;
}

function grandpreEncode(text, src) {
  const rows = grandpreGrid(src);
  const map = new Map();
  rows.forEach((row, r) => [...row].forEach((ch, c) => {
    if (!map.has(ch)) map.set(ch, `${(r + 1) % 10}${(c + 1) % 10}`);
  }));
  const out = [];
  for (const ch of letters(text)) {
    const code = map.get(ch);
    if (!code) throw new Error(`网格中没有字母 ${ch}`);
    out.push(code);
  }
  return out.join(" ");
}

function grandpreDecode(text, src) {
  const rows = grandpreGrid(src);
  const toks = String(text).trim().split(/\s+/).filter(Boolean);
  let out = "";
  for (const t of toks) {
    if (!/^\d{2}$/.test(t)) throw new Error(`Grandpré 坐标需两位数字（收到「${t}」）`);
    const r = (Number(t[0]) + 9) % 10;
    const c = (Number(t[1]) + 9) % 10;
    out += rows[r][c];
  }
  return out;
}

const grandpreOp = {
  id: "d1-grandpre", cat: CAT_CIPHER,
  name: "Grandpré 10×10 同音坐标",
  desc: "10 个 10 字母关键词构成 10×10 方阵，字母取 (行,列) 两位坐标（1-9,0）。默认 dCode 原版方阵；示例 73 09 78 22 29 15 03 88 → GRANDPRE。同字母多坐标时 encode 取首个",
  params: [P("grid", "10×10 方阵（10 个 10 字母词，可无分隔）", GRANDPRE_DEFAULT)],
  encode(text, p) { return grandpreEncode(text, (p && p.grid) || GRANDPRE_DEFAULT); },
  decode(text, p) { return grandpreDecode(text, (p && p.grid) || GRANDPRE_DEFAULT); },
};

function rozierKey(key) {
  const k = letters(key);
  if (!k) throw new Error("Rozier 需要关键字");
  return [...k].map((ch, i) => ((k.charCodeAt((i + 1) % k.length) - k.charCodeAt(i)) % 26 + 26) % 26);
}

function rozierRun(text, key, dec) {
  const shifts = rozierKey(key);
  let ki = 0, out = "";
  for (const ch of String(text)) {
    if (!/[A-Za-z]/.test(ch)) { out += ch; continue; }
    const p = ch.toUpperCase().charCodeAt(0) - 65;
    const sh = shifts[ki % shifts.length];
    ki++;
    out += A[dec ? ((p - sh) % 26 + 26) % 26 : (p + sh) % 26];
  }
  return out;
}

const rozierOp = {
  id: "d1-rozier", cat: CAT_CIPHER,
  name: "Rozier 变体维吉尼亚",
  desc: "把 Rozier 关键字转成相邻字母差（K(i+1)-K(i) mod 26）后作标准维吉尼亚；ROZIER + DCODE → QAOJDQ，解密同密钥反向",
  params: [P("key", "初始关键字", "DCODE")],
  encode(text, p) { return rozierRun(text, (p && p.key) || "DCODE", false); },
  decode(text, p) { return rozierRun(text, (p && p.key) || "DCODE", true); },
};

const TOMTOM_TABLE = {
  A: "/", B: "//", C: "///", D: "////", E: "/\\", F: "//\\", G: "///\\", H: "/\\\\", I: "/\\\\\\",
  J: "\\/", K: "\\\\/", L: "\\\\\\/", M: "\\//", N: "\\///", O: "/\\/", P: "//\\/", Q: "/\\\\/",
  R: "/\\//", S: "\\/\\", T: "\\\\/\\", U: "\\//\\", V: "\\/\\\\", W: "//\\\\", X: "\\\\//",
  Y: "\\/\\/", Z: "/\\/\\",
};
const TOMTOM_REV = new Map();
for (const [k, v] of Object.entries(TOMTOM_TABLE)) {
  if (TOMTOM_REV.has(v)) throw new Error(`Tom-Tom 码表重复：${v}`);
  TOMTOM_REV.set(v, k);
}
const TOMTOM_ORDER = [...TOMTOM_REV.entries()].sort((a, b) => b[0].length - a[0].length);

function tomtomEncode(text) {
  const out = [];
  for (const ch of String(text).toUpperCase()) {
    if (TOMTOM_TABLE[ch]) out.push(TOMTOM_TABLE[ch]);
    else if (/\s/.test(ch)) out.push("");
    else throw new Error(`字符「${ch}」不是 A-Z`);
  }
  return out.join(" ").replace(/\s+/g, " ").trim();
}

function tomtomDecode(text) {
  const s = String(text).trim();
  if (!s) throw new Error("需要 Tom-Tom 密文");
  let toks;
  if (/\s/.test(s)) toks = s.split(/\s+/);
  else {
    toks = [];
    for (let i = 0; i < s.length;) {
      const hit = TOMTOM_ORDER.find(([code]) => s.startsWith(code, i));
      if (!hit) throw new Error(`位置 ${i} 起无法匹配 Tom-Tom 码`);
      toks.push(hit[0]);
      i += hit[0].length;
    }
  }
  return toks.map((t) => {
    const l = TOMTOM_REV.get(t);
    if (!l) throw new Error(`Tom-Tom 记号「${t}」非法`);
    return l;
  }).join("");
}

const tomtomOp = {
  id: "d1-tomtom", cat: CAT_SYM,
  name: "Tom-Tom 斜杠码",
  desc: "A-Z ↔ / \\ 斜杠串（Hayden 表）；TOMTOM → \\/\\ /\\/ \\// \\/\\ /\\/ \\//。无分隔时按最长码贪心解码",
  params: [],
  encode: tomtomEncode,
  decode: tomtomDecode,
};

const NAK_TABLE = {
  0: "Nak", 1: "Nanak", 2: "Nananak", 3: "Nanananak", 4: "Nak?", 5: "nak?",
  6: "Naknak", 7: "Naknaknak", 8: "Nak.", 9: "Naknak.", A: "Naknaknaknak",
  B: "nanak", C: "naknak", D: "nak!", E: "nak.", F: "naknaknak",
};
const NAK_REV = new Map(Object.entries(NAK_TABLE).map(([k, v]) => [v, k]));

function nakEncode(text) {
  const bytes = new TextEncoder().encode(String(text));
  let hex = "";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0").toUpperCase();
  return [...hex].map((d) => NAK_TABLE[d]).join(" ");
}

function nakDecode(text) {
  const toks = String(text).trim().split(/\s+/).filter(Boolean);
  let hex = "";
  for (const t of toks) {
    const d = NAK_REV.get(t);
    if (d === undefined) throw new Error(`Nak-Nak 记号「${t}」非法（大小写敏感）`);
    hex += d;
  }
  if (hex.length % 2 !== 0) throw new Error("Nak-Nak 十六进制位数需为偶数");
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

const naknakOp = {
  id: "d1-naknak", cat: CAT_SYM,
  name: "Nak-Nak 鸭子码",
  desc: "UTF-8 字节 → 十六进制 → Nak/Nanak…/nak! 表（大小写敏感）；Duck → Nak? Nak? Naknaknak nak? Naknak Nanananak Naknak nanak",
  params: [],
  encode: nakEncode,
  decode: nakDecode,
};

const CAD_SEQ = A26.split("");
const CAD_BASE = [1, 27, 53, 79];

function cadOffsets(key) {
  const k = String(key || "AAAA").trim().toUpperCase();
  if (/^\d{8}$/.test(k)) {
    const nums = [0, 2, 4, 6].map((i) => Number(k.slice(i, i + 2)));
    return nums.map((n, d) => {
      const v = d === 3 && n === 0 ? 100 : n;
      const hi = d === 3 ? 100 : CAD_BASE[d] + 25;
      if (v < CAD_BASE[d] || v > hi) throw new Error(`第 ${d + 1} 盘位置 ${k.slice(d * 2, d * 2 + 2)} 超出范围`);
      return (v - CAD_BASE[d]) % 26;
    });
  }
  const ls = k.replace(/[^A-Z]/g, "");
  if (ls.length !== 4) throw new Error("Cadran 密钥需 4 个字母或 8 位数字");
  return [...ls].map((ch) => {
    const i = CAD_SEQ.indexOf(ch);
    if (i < 0) throw new Error(`密钥字母「${ch}」不在字母盘`);
    return i;
  });
}

function cadEncode(text, key, disk) {
  const off = cadOffsets(key);
  const d = intParam(disk || 1, "disk", 1, 4) - 1;
  const out = [];
  for (const ch of String(text).toUpperCase()) {
    const i = CAD_SEQ.indexOf(ch);
    if (i < 0) { out.push(ch); continue; }
    const num = CAD_BASE[d] + ((i - off[d]) % 26 + 26) % 26;
    if (d === 3 && num > 99) {
      if (num === 100) out.push("00");
      else throw new Error(`第 4 盘 ${num} 是空格位（101-104），请改用 1-3 盘`);
    } else {
      out.push(String(num).padStart(2, "0"));
    }
  }
  return out.join(" ");
}

function cadDecode(text, key) {
  const off = cadOffsets(key);
  const s = String(text).trim();
  const toks = /\s/.test(s) ? s.split(/\s+/).filter(Boolean) : s.match(/.{1,2}/g) || [];
  let out = "";
  for (const t of toks) {
    if (!/^\d{2,3}$/.test(t)) throw new Error(`Cadran 码「${t}」需 2-3 位数字`);
    const n = Number(t);
    let d, pos;
    if (n >= 1 && n <= 26) { d = 0; pos = n - CAD_BASE[0]; }
    else if (n >= 27 && n <= 52) { d = 1; pos = n - CAD_BASE[1]; }
    else if (n >= 53 && n <= 78) { d = 2; pos = n - CAD_BASE[2]; }
    else if (n >= 79 && n <= 99) { d = 3; pos = n - CAD_BASE[3]; }
    else if (n === 100) { d = 3; pos = 21; }
    else if (n >= 101 && n <= 104) throw new Error(`Cadran 码 ${t} 是第 4 盘空格位（101-104），不可解码`);
    else throw new Error(`Cadran 码 ${t} 不在 01..100`);
    out += CAD_SEQ[(pos - off[d] + 52) % 26];
  }
  return out;
}

const cadranOp = {
  id: "d1-cadran", cat: CAT_CIPHER,
  name: "墨西哥军密码盘（Cadran）",
  desc: "4 个同心盘，每盘 26 格；01-26/27-52/53-78/79-104（100 写 00）按密钥字母旋转。默认 AAAA、1 盘：DCODE → 04 03 15 04 05；同字母可落不同盘",
  params: [P("key", "密钥（4 字母或 8 位数字）", "AAAA"), SEL("disk", "编码盘", "1", [{ value: "1", label: "盘 1（01-26）" }, { value: "2", label: "盘 2（27-52）" }, { value: "3", label: "盘 3（53-78）" }, { value: "4", label: "盘 4（79-104）" }])],
  encode(text, p) { return cadEncode(text, (p && p.key) || "AAAA", (p && p.disk) || "1"); },
  decode(text, p) { return cadDecode(text, (p && p.key) || "AAAA"); },
};

function parseNomenclature(src) {
  const map = new Map();
  const rev = new Map();
  for (const line of String(src || "").split(/\r?\n|;/)) {
    const m = line.match(/^\s*([A-Za-z])\s*[=:]\s*(.+?)\s*$/);
    if (!m) continue;
    const k = m[1].toUpperCase();
    const w = m[2].trim();
    if (!w) continue;
    if (map.has(k)) throw new Error(`Nomenclature 字母 ${k} 重复`);
    if (rev.has(w)) throw new Error(`Nomenclature 词「${w}」重复`);
    map.set(k, w);
    rev.set(w, k);
  }
  if (!map.size) throw new Error("需要 Nomenclature 对照表（每行 A=词）");
  return { map, rev };
}

function nomenclatureEncode(text, src) {
  const { map } = parseNomenclature(src);
  const out = [];
  for (const ch of String(text).toUpperCase()) {
    const i = idx(ch);
    if (i < 0) continue;
    const w = map.get(ch);
    if (!w) throw new Error(`对照表缺少字母 ${ch}`);
    out.push(w);
  }
  return out.join(" ");
}

function nomenclatureDecode(text, src) {
  const { rev } = parseNomenclature(src);
  const toks = String(text).trim().split(/[\s,;]+/).filter(Boolean);
  let out = "";
  for (const t of toks) {
    const k = rev.get(t);
    if (!k) throw new Error(`词「${t}」不在 Nomenclature 对照表`);
    out += k;
  }
  return out;
}

const nomenclatureOp = {
  id: "d1-nomenclature", cat: CAT_CIPHER,
  name: "Nomenclature 词表替换",
  desc: "用户提供 A=词 对照表，把字母换成词（同义于 Substitution par Mots / 首字母藏头）。ABC + A=Alpha,B=Bravo,C=Charlie → Alpha Bravo Charlie",
  params: [{ key: "map", label: "对照表（每行 A=词）", type: "textarea", default: "A=Alpha\nB=Bravo\nC=Charlie\nD=Delta\nE=Echo" }],
  encode(text, p) { return nomenclatureEncode(text, p && p.map); },
  decode(text, p) { return nomenclatureDecode(text, p && p.map); },
};

const TTT_TABLE = {};
for (let i = 0; i < 9; i++) TTT_TABLE[String.fromCharCode(65 + i)] = `#${i + 1}`;
for (let i = 0; i < 9; i++) TTT_TABLE[String.fromCharCode(74 + i)] = `X${i + 1}`;
for (let i = 0; i < 8; i++) TTT_TABLE[String.fromCharCode(83 + i)] = `O${i + 1}`;
const TTT_REV = new Map(Object.entries(TTT_TABLE).map(([k, v]) => [v, k]));

function tictactoeEncode(text) {
  const out = [];
  for (const ch of String(text).toUpperCase()) {
    if (TTT_TABLE[ch]) out.push(TTT_TABLE[ch]);
    else if (/\s/.test(ch)) out.push("");
    else throw new Error(`字符「${ch}」不是 A-Z`);
  }
  return out.join(" ").replace(/\s+/g, " ").trim();
}

function tictactoeDecode(text) {
  const toks = String(text).trim().split(/\s+/).filter(Boolean);
  let out = "";
  for (const t of toks) {
    const l = TTT_REV.get(t);
    if (!l) throw new Error(`Tic-Tac-Toe 记号「${t}」非法`);
    out += l;
  }
  return out;
}

const tictactoeOp = {
  id: "d1-tictactoe", cat: CAT_SYM,
  name: "Tic-Tac-Toe 井字格密码",
  desc: "结构式：A-I=#1..#9（空格位）、J-R=X1..X9（叉）、S-Z=O1..O8（圈）；每个 token 对应格位+标记。TICTACTOE 可往返",
  params: [],
  encode: tictactoeEncode,
  decode: tictactoeDecode,
};

const SCREAM_TABLE = {
  A: "A", B: "Ȧ", C: "A̧", D: "A̱", E: "Á", F: "A̮", G: "A̋", H: "A̰", I: "Ả", J: "A̓",
  K: "Ạ", L: "Ă", M: "Ǎ", N: "Â", O: "Å", P: "A̯", Q: "A̤", R: "Ȃ", S: "Ã", T: "Ā",
  U: "Ä", V: "À", W: "Ȁ", X: "A̽", Y: "A̦", Z: "Ⱥ",
};
const SCREAM_REV = [];
for (const [k, v] of Object.entries(SCREAM_TABLE)) {
  const nfd = v.normalize("NFD");
  if (SCREAM_REV.some((x) => x.nfd === nfd)) throw new Error(`Scream 表重复：${v}`);
  SCREAM_REV.push({ nfd, k });
}
SCREAM_REV.sort((a, b) => b.nfd.length - a.nfd.length);

function screamEncode(text) {
  let out = "";
  for (const ch of String(text).toUpperCase()) out += SCREAM_TABLE[ch] || ch;
  return out;
}

function screamDecode(text) {
  const s = String(text).normalize("NFD");
  let out = "";
  for (let i = 0; i < s.length;) {
    const hit = SCREAM_REV.find((x) => s.startsWith(x.nfd, i));
    if (!hit) throw new Error(`位置 ${i} 起的 A 变体不在 Scream 表`);
    out += hit.k;
    i += hit.nfd.length;
  }
  return out;
}

const screamOp = {
  id: "d1-scream", cat: CAT_SYM,
  name: "Scream 尖叫码（xkcd）",
  desc: "每个字母 → 带特定变音符号的 A（U+xxxx）；SCREAM → ÃA̧ȂÁAǍ，A̱A̧ÅA̱Á → DCODE。解码按 NFD 归一匹配",
  params: [],
  encode: screamEncode,
  decode: screamDecode,
};

const MAC_PAIRS = [["a","å"],["F","Ï"],["!","⁄"],["b","∫"],["G","˝"],["@","€"],["c","ç"],["H","Ó"],["#","‹"],["d","∂"],["I","ˆ"],["$","›"],["e","´"],["J","Ô"],["%","ﬁ"],["f","ƒ"],["K",""],["^","ﬂ"],["g","©"],["L","Ò"],["&","‡"],["h","˙"],["M","Â"],["*","°"],["i","ˆ"],["N","˜"],["(","·"],["j","∆"],["O","Ø"],[")","‚"],["k","˚"],["P","∏"],[",","≤"],["l","¬"],["Q","Œ"],[".","≥"],["m","µ"],["R","‰"],[";","…"],["n","˜"],["S","Í"],[":","Ú"],["o","ø"],["T","ˇ"],["/","÷"],["p","π"],["U","¨"],["<","¯"],["q","œ"],["V","◊"],[">","˘"],["r","®"],["W","„"],["?","¿"],["s","ß"],["X","˛"],["-","–"],["t","†"],["Y","Á"],["_","—"],["u","¨"],["Z","¸"],["=","≠"],["v","√"],["1","¡"],["[","“"],["w","∑"],["2","™"],["]","‘"],["x","≈"],["3","£"],["{","”"],["y","¥"],["4","¢"],["}","’"],["z","Ω"],["5","∞"],["\\","«"],["A","Å"],["6","§"],["|","»"],["B","ı"],["7","¶"],["'","æ"],["C","Ç"],["8","•"],["\"","Æ"],["D","Î"],["9","ª"],["+","±"],["E","´"],["0","º"],["~","`"]];
const MAC_ENC = new Map(MAC_PAIRS);
const MAC_DEC = new Map();
for (const [k, v] of MAC_PAIRS) {
  if (!MAC_DEC.has(v)) MAC_DEC.set(v, k);
  else if (/[a-z]/.test(k) && /[A-Z]/.test(MAC_DEC.get(v))) MAC_DEC.set(v, k);
}

function macOptionEncode(text) {
  let out = "";
  for (const ch of String(text)) out += MAC_ENC.get(ch) || ch;
  return out;
}

function macOptionDecode(text) {
  let out = "";
  for (const ch of String(text)) out += MAC_DEC.get(ch) || ch;
  return out;
}

const macOptionOp = {
  id: "d1-mac-option", cat: CAT_SYM,
  name: "Mac Option 键符号",
  desc: "macOS Option+键 的特殊字符表（93 对）；Option → Øπ†ˆø˜，Âåç → Mac。e/E、i/I、n/N、u/U 共用符号，解码取小写",
  params: [],
  encode: macOptionEncode,
  decode: macOptionDecode,
};

function moduloEncode(text, N, k) {
  const out = [];
  for (const ch of String(text).toUpperCase()) {
    const i = idx(ch);
    if (i < 0) { out.push(ch); continue; }
    out.push(String(i + 1 + k * N));
  }
  return out.join(" ").replace(/\s+/g, " ").trim();
}

function moduloDecode(text, N) {
  const toks = String(text).trim().split(/[\s,;]+/).filter(Boolean);
  const out = [];
  for (const t of toks) {
    if (/^-?\d+$/.test(t)) {
      const r = ((Number(t) % N) + N) % N;
      if (N === 26) out.push(r === 0 ? "Z" : A[r - 1]);
      else out.push(String(r));
    } else {
      out.push(t);
    }
  }
  return N === 26 ? out.join("") : out.join(" ");
}

const moduloOp = {
  id: "d1-modulo", cat: CAT_CIPHER,
  name: "模 N 同音密码（Modulo）",
  desc: "字母先转 A1Z26，再编码为 rank + k×N（同余类可任选大数）；解密取 mod N。N=26 时映射回字母：654 965 561 732 941 → DCODE",
  params: [P("N", "模 N", "26"), P("k", "编码乘数 k", "100")],
  encode(text, p) { return moduloEncode(text, intParam((p && p.N) || 26, "N", 2, 100000), intParam((p && p.k) || 100, "k", 0, 1000000)); },
  decode(text, p) { return moduloDecode(text, intParam((p && p.N) || 26, "N", 2, 100000)); },
};

export const OPS = [
  playfairOp,
  albhedOp,
  codeClawOp,
  rankAnchorOp,
  greekRankOp,
  alphaSumOp,
  cvRankOp,
  primeSubstOp,
  primeMultOp,
  mirrorDigitsOp,
  asciiShiftOp,
  progressiveCaesarOp,
  unicodeShiftOp,
  asciiControlsOp,
  wordPatternOp,
  fourElementsOp,
  chineseZodiacOp,
  wolseleyOp,
  swagmanOp,
  grandpreOp,
  rozierOp,
  tomtomOp,
  naknakOp,
  cadranOp,
  nomenclatureOp,
  tictactoeOp,
  screamOp,
  macOptionOp,
  moduloOp,
];

export const COVERAGE_CATEGORIES = {
  symbols: "Substitution par Symboles",
  grid: "Chiffrement par Grille",
  beliefs: "Croyances",
  history: "Histoire (Autre/non classé)",
  homophonic: "Chiffrement par Substitution Homophonique",
};

export const COVERAGE = [
  {
    cat: "symbols",
    name: "★ Chiffrements avec Symboles",
    slug: "chiffres-symboles",
    url: "https://www.dcode.fr/chiffres-symboles",
    status: "blocked",
    reason: "参考/索引/文档类工具，不是可逆编码算法。",
  },
  {
    cat: "symbols",
    name: "Afficheur 7-Segments",
    slug: "afficheur-7-segments",
    url: "https://www.dcode.fr/afficheur-7-segments",
    status: "mapped",
    op: "dcode-extras-2026-10/num-sevenseg",
    note: "插件既有 7 段显示 op",
  },
  {
    cat: "symbols",
    name: "Alphabet Alien 2 de Futurama",
    slug: "alphabet-alien-2-futurama",
    url: "https://www.dcode.fr/alphabet-alien-2-futurama",
    status: "mapped",
    op: "alienAlphabet",
    note: "mode futurama2（AL2）",
  },
  {
    cat: "symbols",
    name: "Alphabet Alien de Futurama",
    slug: "alphabet-alien-futurama",
    url: "https://www.dcode.fr/alphabet-alien-futurama",
    status: "mapped",
    op: "alienAlphabet",
    note: "mode unicode（dCode Alien 表）",
  },
  {
    cat: "symbols",
    name: "Alphabet Alternien",
    slug: "alphabet-alternien",
    url: "https://www.dcode.fr/alphabet-alternien",
    status: "blocked",
    reason: "dCode 页面仅提供位图/字体字形，缺少可核验的权威文本或 Unicode 映射；按任务规则不猜测。",
  },
  {
    cat: "symbols",
    name: "Alphabet Amphibia",
    slug: "alphabet-amphibia",
    url: "https://www.dcode.fr/alphabet-amphibia",
    status: "blocked",
    reason: "dCode 页面仅提供位图/字体字形，缺少可核验的权威文本或 Unicode 映射；按任务规则不猜测。",
  },
  {
    cat: "symbols",
    name: "Alphabet Arthur et les Minimoys",
    slug: "chiffre-arthur-minimoys",
    url: "https://www.dcode.fr/chiffre-arthur-minimoys",
    status: "blocked",
    reason: "dCode 页面仅提供位图/字体字形，缺少可核验的权威文本或 Unicode 映射；按任务规则不猜测。",
  },
  {
    cat: "symbols",
    name: "Alphabet Aurebesh",
    slug: "alphabet-aurebesh",
    url: "https://www.dcode.fr/alphabet-aurebesh",
    status: "blocked",
    reason: "dCode 页面仅提供位图/字体字形，缺少可核验的权威文本或 Unicode 映射；按任务规则不猜测。",
  },
  {
    cat: "symbols",
    name: "Alphabet Ballet",
    slug: "alphabet-ballet",
    url: "https://www.dcode.fr/alphabet-ballet",
    status: "blocked",
    reason: "输入为图像/手势/乐谱/字体渲染，需图像识别或字体 cmap，纯文本 op 无法忠实处理。",
  },
  {
    cat: "symbols",
    name: "Alphabet Braille",
    slug: "alphabet-braille",
    url: "https://www.dcode.fr/alphabet-braille",
    status: "mapped",
    op: "braille",
    note: "主工具箱盲文 op",
  },
  {
    cat: "symbols",
    name: "Alphabet Celestial",
    slug: "alphabet-celestial",
    url: "https://www.dcode.fr/alphabet-celestial",
    status: "mapped",
    op: "occult",
    note: "alphabet=celestial",
  },
  {
    cat: "symbols",
    name: "Alphabet Chappe",
    slug: "alphabet-chappe",
    url: "https://www.dcode.fr/alphabet-chappe",
    status: "blocked",
    reason: "dCode 页面仅提供位图/字体字形，缺少可核验的权威文本或 Unicode 映射；按任务规则不猜测。",
  },
  {
    cat: "symbols",
    name: "Alphabet Circular Glyphs",
    slug: "alphabet-circular-glyphs",
    url: "https://www.dcode.fr/alphabet-circular-glyphs",
    status: "blocked",
    reason: "dCode 页面仅提供位图/字体字形，缺少可核验的权威文本或 Unicode 映射；按任务规则不猜测。",
  },
  {
    cat: "symbols",
    name: "Alphabet Daedrique",
    slug: "langage-daedrique",
    url: "https://www.dcode.fr/langage-daedrique",
    status: "blocked",
    reason: "dCode 页面仅提供位图/字体字形，缺少可核验的权威文本或 Unicode 映射；按任务规则不猜测。",
  },
  {
    cat: "symbols",
    name: "Alphabet Dinotopia",
    slug: "alphabet-dinotopia",
    url: "https://www.dcode.fr/alphabet-dinotopia",
    status: "blocked",
    reason: "dCode 页面仅提供位图/字体字形，缺少可核验的权威文本或 Unicode 映射；按任务规则不猜测。",
  },
  {
    cat: "symbols",
    name: "Alphabet Dothraki",
    slug: "alphabet-dothraki",
    url: "https://www.dcode.fr/alphabet-dothraki",
    status: "blocked",
    reason: "自然语言翻译/音译，非确定性密码，需词典或联网。",
  },
  {
    cat: "symbols",
    name: "Alphabet Enochien",
    slug: "langage-enochien",
    url: "https://www.dcode.fr/langage-enochien",
    status: "blocked",
    reason: "dCode 页面仅提供位图/字体字形，缺少可核验的权威文本或 Unicode 映射；按任务规则不猜测。",
  },
  {
    cat: "symbols",
    name: "Alphabet Fez",
    slug: "alphabet-fez",
    url: "https://www.dcode.fr/alphabet-fez",
    status: "blocked",
    reason: "dCode 页面仅提供位图/字体字形，缺少可核验的权威文本或 Unicode 映射；按任务规则不猜测。",
  },
  {
    cat: "symbols",
    name: "Alphabet Galactique Standard",
    slug: "alphabet-galactique-standard",
    url: "https://www.dcode.fr/alphabet-galactique-standard",
    status: "mapped",
    op: "sga",
    note: "主工具箱 SGA",
  },
  {
    cat: "symbols",
    name: "Alphabet Gobelin de Tolkien",
    slug: "alphabet-gobelin-tolkien",
    url: "https://www.dcode.fr/alphabet-gobelin-tolkien",
    status: "blocked",
    reason: "dCode 页面仅提供位图/字体字形，缺少可核验的权威文本或 Unicode 映射；按任务规则不猜测。",
  },
  {
    cat: "symbols",
    name: "Alphabet Hymnos",
    slug: "alphabet-hymnos",
    url: "https://www.dcode.fr/alphabet-hymnos",
    status: "blocked",
    reason: "dCode 页面仅提供位图/字体字形，缺少可核验的权威文本或 Unicode 映射；按任务规则不猜测。",
  },
  {
    cat: "symbols",
    name: "Alphabet Illageralt",
    slug: "ecriture-illageralt",
    url: "https://www.dcode.fr/ecriture-illageralt",
    status: "blocked",
    reason: "dCode 页面仅提供位图/字体字形，缺少可核验的权威文本或 Unicode 映射；按任务规则不猜测。",
  },
  {
    cat: "symbols",
    name: "Alphabet Infernal",
    slug: "alphabet-infernal",
    url: "https://www.dcode.fr/alphabet-infernal",
    status: "blocked",
    reason: "dCode 页面仅提供位图/字体字形，缺少可核验的权威文本或 Unicode 映射；按任务规则不猜测。",
  },
  {
    cat: "symbols",
    name: "Alphabet Kirby (Monde Oublié)",
    slug: "alphabet-kirby-monde-oublie",
    url: "https://www.dcode.fr/alphabet-kirby-monde-oublie",
    status: "blocked",
    reason: "dCode 页面仅提供位图/字体字形，缺少可核验的权威文本或 Unicode 映射；按任务规则不猜测。",
  },
  {
    cat: "symbols",
    name: "Alphabet Kromagg (Sliders)",
    slug: "alphabet-kromagg-sliders",
    url: "https://www.dcode.fr/alphabet-kromagg-sliders",
    status: "blocked",
    reason: "dCode 页面仅提供位图/字体字形，缺少可核验的权威文本或 Unicode 映射；按任务规则不猜测。",
  },
  {
    cat: "symbols",
    name: "Alphabet Kryptonien",
    slug: "alphabet-kryptonien",
    url: "https://www.dcode.fr/alphabet-kryptonien",
    status: "blocked",
    reason: "dCode 页面仅提供位图/字体字形，缺少可核验的权威文本或 Unicode 映射；按任务规则不猜测。",
  },
  {
    cat: "symbols",
    name: "Alphabet Lunaire (L. Katz)",
    slug: "alphabet-lunaire-leandro-katz",
    url: "https://www.dcode.fr/alphabet-lunaire-leandro-katz",
    status: "mapped",
    op: "occult",
    note: "alphabet=lunaire",
  },
  {
    cat: "symbols",
    name: "Alphabet Magi",
    slug: "alphabet-magi-raphael",
    url: "https://www.dcode.fr/alphabet-magi-raphael",
    status: "blocked",
    reason: "dCode 页面仅提供位图/字体字形，缺少可核验的权威文本或 Unicode 映射；按任务规则不猜测。",
  },
  {
    cat: "symbols",
    name: "Alphabet Malachim",
    slug: "alphabet-malachim",
    url: "https://www.dcode.fr/alphabet-malachim",
    status: "mapped",
    op: "occult",
    note: "alphabet=malachim",
  },
  {
    cat: "symbols",
    name: "Alphabet Monklish",
    slug: "alphabet-monklish",
    url: "https://www.dcode.fr/alphabet-monklish",
    status: "blocked",
    reason: "dCode 页面仅提供位图/字体字形，缺少可核验的权威文本或 Unicode 映射；按任务规则不猜测。",
  },
  {
    cat: "symbols",
    name: "Alphabet Moon",
    slug: "alphabet-moon",
    url: "https://www.dcode.fr/alphabet-moon",
    status: "blocked",
    reason: "dCode 页面仅提供位图/字体字形，缺少可核验的权威文本或 Unicode 映射；按任务规则不猜测。",
  },
  {
    cat: "symbols",
    name: "Alphabet Mourier",
    slug: "alphabet-mourier",
    url: "https://www.dcode.fr/alphabet-mourier",
    status: "blocked",
    reason: "dCode 页面仅提供位图/字体字形，缺少可核验的权威文本或 Unicode 映射；按任务规则不猜测。",
  },
  {
    cat: "symbols",
    name: "Alphabet Nazcaä",
    slug: "alphabet-nazcaa",
    url: "https://www.dcode.fr/alphabet-nazcaa",
    status: "blocked",
    reason: "dCode 页面仅提供位图/字体字形，缺少可核验的权威文本或 Unicode 映射；按任务规则不猜测。",
  },
  {
    cat: "symbols",
    name: "Alphabet Ninjargon (Lego Ninjago)",
    slug: "alphabet-ninjargon",
    url: "https://www.dcode.fr/alphabet-ninjargon",
    status: "blocked",
    reason: "dCode 页面仅提供位图/字体字形，缺少可核验的权威文本或 Unicode 映射；按任务规则不猜测。",
  },
  {
    cat: "symbols",
    name: "Alphabet Ogham",
    slug: "alphabet-ogham",
    url: "https://www.dcode.fr/alphabet-ogham",
    status: "mapped",
    op: "dcode-extras-2026-10/num-ogham",
    note: "插件欧甘字母",
  },
  {
    cat: "symbols",
    name: "Alphabet Ophidien (Ultima)",
    slug: "alphabet-ophidien-ultima",
    url: "https://www.dcode.fr/alphabet-ophidien-ultima",
    status: "blocked",
    reason: "dCode 页面仅提供位图/字体字形，缺少可核验的权威文本或 Unicode 映射；按任务规则不猜测。",
  },
  {
    cat: "symbols",
    name: "Alphabet Passage du Fleuve",
    slug: "alphabet-passage-fleuve",
    url: "https://www.dcode.fr/alphabet-passage-fleuve",
    status: "blocked",
    reason: "dCode 页面仅提供位图/字体字形，缺少可核验的权威文本或 Unicode 映射；按任务规则不猜测。",
  },
  {
    cat: "symbols",
    name: "Alphabet Pokemon Zarbi",
    slug: "pokemon-zarbi-alphabet",
    url: "https://www.dcode.fr/pokemon-zarbi-alphabet",
    status: "blocked",
    reason: "dCode 页面仅提供位图/字体字形，缺少可核验的权威文本或 Unicode 映射；按任务规则不猜测。",
  },
  {
    cat: "symbols",
    name: "Alphabet Stray",
    slug: "alphabet-stray",
    url: "https://www.dcode.fr/alphabet-stray",
    status: "blocked",
    reason: "dCode 页面仅提供位图/字体字形，缺少可核验的权威文本或 Unicode 映射；按任务规则不猜测。",
  },
  {
    cat: "symbols",
    name: "Alphabet Sémaphore",
    slug: "alphabet-semaphore",
    url: "https://www.dcode.fr/alphabet-semaphore",
    status: "mapped",
    op: "semaphore",
    note: "主工具箱旗语",
  },
  {
    cat: "symbols",
    name: "Alphabet Tenctonais",
    slug: "alphabet-tenctonais",
    url: "https://www.dcode.fr/alphabet-tenctonais",
    status: "blocked",
    reason: "dCode 页面仅提供位图/字体字形，缺少可核验的权威文本或 Unicode 映射；按任务规则不猜测。",
  },
  {
    cat: "symbols",
    name: "Alphabet Thébain",
    slug: "alphabet-thebain",
    url: "https://www.dcode.fr/alphabet-thebain",
    status: "mapped",
    op: "occult",
    note: "alphabet=theban",
  },
  {
    cat: "symbols",
    name: "Alphabet Tifinagh (ⵜⵉⴼⵉⵏⴰⵖ)",
    slug: "alphabet-tifinagh",
    url: "https://www.dcode.fr/alphabet-tifinagh",
    status: "mapped",
    op: "dcode-extras-2026-10/num-tifinagh",
    note: "插件提非纳字母",
  },
  {
    cat: "symbols",
    name: "Alphabet Wakanda",
    slug: "alphabet-wakanda",
    url: "https://www.dcode.fr/alphabet-wakanda",
    status: "blocked",
    reason: "dCode 页面仅提供位图/字体字形，缺少可核验的权威文本或 Unicode 映射；按任务规则不猜测。",
  },
  {
    cat: "symbols",
    name: "Alphabet de la Bordure Extérieure",
    slug: "alphabet-bordure-exterieure",
    url: "https://www.dcode.fr/alphabet-bordure-exterieure",
    status: "blocked",
    reason: "dCode 页面仅提供位图/字体字形，缺少可核验的权威文本或 Unicode 映射；按任务规则不猜测。",
  },
  {
    cat: "symbols",
    name: "Alphabet des Anciens de Stargate",
    slug: "alphabet-anciens-stargate",
    url: "https://www.dcode.fr/alphabet-anciens-stargate",
    status: "blocked",
    reason: "dCode 页面仅提供位图/字体字形，缺少可核验的权威文本或 Unicode 映射；按任务规则不猜测。",
  },
  {
    cat: "symbols",
    name: "Alphabet des Anges et des Génies",
    slug: "alphabet-anges-genies",
    url: "https://www.dcode.fr/alphabet-anges-genies",
    status: "mapped",
    op: "occult",
    note: "celestial/malachim 两档",
  },
  {
    cat: "symbols",
    name: "Alphabet des Dagues",
    slug: "alphabet-dagues",
    url: "https://www.dcode.fr/alphabet-dagues",
    status: "blocked",
    reason: "dCode 页面仅提供位图/字体字形，缺少可核验的权威文本或 Unicode 映射；按任务规则不猜测。",
  },
  {
    cat: "symbols",
    name: "Alphabetum Kaldeorum",
    slug: "alphabetum-kaldeorum-rodolphe-iv",
    url: "https://www.dcode.fr/alphabetum-kaldeorum-rodolphe-iv",
    status: "blocked",
    reason: "dCode 页面仅提供位图/字体字形，缺少可核验的权威文本或 Unicode 映射；按任务规则不猜测。",
  },
  {
    cat: "symbols",
    name: "Angles Sémaphore",
    slug: "angle-semaphore",
    url: "https://www.dcode.fr/angle-semaphore",
    status: "mapped",
    op: "semaphore",
    note: "旗语角度",
  },
  {
    cat: "symbols",
    name: "Chiffre Betamaze",
    slug: "chiffre-betamaze",
    url: "https://www.dcode.fr/chiffre-betamaze",
    status: "blocked",
    reason: "dCode 页面仅提供位图/字体字形，缺少可核验的权威文本或 Unicode 映射；按任务规则不猜测。",
  },
  {
    cat: "symbols",
    name: "Chiffre Dorabella",
    slug: "chiffre-dorabella",
    url: "https://www.dcode.fr/chiffre-dorabella",
    status: "blocked",
    reason: "原文未破译或符号集无公认映射，任何替换表都是猜测。",
  },
  {
    cat: "symbols",
    name: "Chiffre Friderici (Fenêtres)",
    slug: "chiffre-friderici-fenetres",
    url: "https://www.dcode.fr/chiffre-friderici-fenetres",
    status: "blocked",
    reason: "dCode 页面仅提供位图/字体字形，缺少可核验的权威文本或 Unicode 映射；按任务规则不猜测。",
  },
  {
    cat: "symbols",
    name: "Chiffre Oiseaux sur un Fil",
    slug: "chiffre-oiseaux-sur-un-fil",
    url: "https://www.dcode.fr/chiffre-oiseaux-sur-un-fil",
    status: "blocked",
    reason: "dCode 页面仅提供位图/字体字形，缺少可核验的权威文本或 Unicode 映射；按任务规则不猜测。",
  },
  {
    cat: "symbols",
    name: "Chiffre Pig Pen des Francs-maçons",
    slug: "chiffre-pig-pen-francs-macons",
    url: "https://www.dcode.fr/chiffre-pig-pen-francs-macons",
    status: "mapped",
    op: "pigpen",
    note: "主工具箱猪圈密码",
  },
  {
    cat: "symbols",
    name: "Chiffre RataAlada (Batman)",
    slug: "chiffre-rata-alada",
    url: "https://www.dcode.fr/chiffre-rata-alada",
    status: "blocked",
    reason: "dCode 页面仅提供位图/字体字形，缺少可核验的权威文本或 Unicode 映射；按任务规则不猜测。",
  },
  {
    cat: "symbols",
    name: "Chiffre Sémaphore Trousers",
    slug: "chiffre-semaphore-trousers",
    url: "https://www.dcode.fr/chiffre-semaphore-trousers",
    status: "blocked",
    reason: "dCode 页面仅提供位图/字体字形，缺少可核验的权威文本或 Unicode 映射；按任务规则不猜测。",
  },
  {
    cat: "symbols",
    name: "Chiffre Tic-Tac-Toe",
    slug: "chiffre-tic-tac-toe",
    url: "https://www.dcode.fr/chiffre-tic-tac-toe",
    status: "implemented",
    op: "d1-tictactoe",
    note: "结构式 token（格位+无/X/O 标记）",
  },
  {
    cat: "symbols",
    name: "Chiffre Tueur du Zodiac",
    slug: "chiffre-tueur-zodiac",
    url: "https://www.dcode.fr/chiffre-tueur-zodiac",
    status: "mapped",
    op: "zodiac",
    note: "主工具箱 Z408",
  },
  {
    cat: "symbols",
    name: "Chiffre de Voynich",
    slug: "manuscrit-voynich",
    url: "https://www.dcode.fr/manuscrit-voynich",
    status: "blocked",
    reason: "原文未破译或符号集无公认映射，任何替换表都是猜测。",
  },
  {
    cat: "symbols",
    name: "Chiffre de la Rose-Croix",
    slug: "chiffre-rose-croix",
    url: "https://www.dcode.fr/chiffre-rose-croix",
    status: "blocked",
    reason: "dCode 页面仅提供位图/字体字形，缺少可核验的权威文本或 Unicode 映射；按任务规则不猜测。",
  },
  {
    cat: "symbols",
    name: "Chiffre des Hommes Dansants",
    slug: "chiffre-hommes-dansants",
    url: "https://www.dcode.fr/chiffre-hommes-dansants",
    status: "mapped",
    op: "dancingMen",
    note: "主工具箱跳舞小人",
  },
  {
    cat: "symbols",
    name: "Chiffre des Templiers",
    slug: "chiffre-templiers",
    url: "https://www.dcode.fr/chiffre-templiers",
    status: "blocked",
    reason: "dCode 页面仅提供位图/字体字形，缺少可核验的权威文本或 Unicode 映射；按任务规则不猜测。",
  },
  {
    cat: "symbols",
    name: "Chiffre du Scarabée d'Or 3‡0†2?3",
    slug: "scarabee-or-poe",
    url: "https://www.dcode.fr/scarabee-or-poe",
    status: "mapped",
    op: "goldbug",
    note: "主工具箱金甲虫",
  },
  {
    cat: "symbols",
    name: "Chiffre par Partition Musicale",
    slug: "chiffre-partition-musicale",
    url: "https://www.dcode.fr/chiffre-partition-musicale",
    status: "blocked",
    reason: "存在多个互不兼容的变体，dCode 未给出唯一文本表。",
  },
  {
    cat: "symbols",
    name: "Chiffres Miroir",
    slug: "chiffres-miroir",
    url: "https://www.dcode.fr/chiffres-miroir",
    status: "implemented",
    op: "d1-mirror-digits",
  },
  {
    cat: "symbols",
    name: "Code Acéré",
    slug: "chiffre-acere",
    url: "https://www.dcode.fr/chiffre-acere",
    status: "blocked",
    reason: "存在多个互不兼容的变体，dCode 未给出唯一文本表。",
  },
  {
    cat: "symbols",
    name: "Code Bibi-binaire",
    slug: "code-bibi-binaire",
    url: "https://www.dcode.fr/code-bibi-binaire",
    status: "mapped",
    op: "dcode-extras-2026-10/num-bibi",
    note: "插件 Bibi 二进制",
  },
  {
    cat: "symbols",
    name: "Code Chappe",
    slug: "code-chappe",
    url: "https://www.dcode.fr/code-chappe",
    status: "blocked",
    reason: "依赖 dCode 未公开或需同版本外部码本（词表、页码、共版书籍），无法离线确定性复现。",
  },
  {
    cat: "symbols",
    name: "Code Chinois (à Bâtons)",
    slug: "code-chinois",
    url: "https://www.dcode.fr/code-chinois",
    status: "mapped",
    op: "countingRods",
    note: "主工具箱算筹",
  },
  {
    cat: "symbols",
    name: "Code Hexagramme",
    slug: "hexagramme",
    url: "https://www.dcode.fr/hexagramme",
    status: "mapped",
    op: "dcode-extras-2026-10/sym-hexagram",
    note: "插件六十四卦",
  },
  {
    cat: "symbols",
    name: "Code Horloge (Clock)",
    slug: "code-horloge-clock",
    url: "https://www.dcode.fr/code-horloge-clock",
    status: "mapped",
    op: "clockCipher",
    note: "主工具箱时钟码",
  },
  {
    cat: "symbols",
    name: "Code Tom-Tom ///\\\\/",
    slug: "code-tom-tom",
    url: "https://www.dcode.fr/code-tom-tom",
    status: "implemented",
    op: "d1-tomtom",
  },
  {
    cat: "symbols",
    name: "Code Touche Option",
    slug: "code-touche-option-mac",
    url: "https://www.dcode.fr/code-touche-option-mac",
    status: "implemented",
    op: "d1-mac-option",
  },
  {
    cat: "symbols",
    name: "Code de Mary Stuart",
    slug: "code-mary-stuart",
    url: "https://www.dcode.fr/code-mary-stuart",
    status: "blocked",
    reason: "依赖 dCode 未公开或需同版本外部码本（词表、页码、共版书籍），无法离线确定性复现。",
  },
  {
    cat: "symbols",
    name: "Code de la Griffe (Gregor)",
    slug: "code-griffe-gregor",
    url: "https://www.dcode.fr/code-griffe-gregor",
    status: "implemented",
    op: "d1-code-claw",
  },
  {
    cat: "symbols",
    name: "Code des Dada Ourka",
    slug: "code-dada-ourka",
    url: "https://www.dcode.fr/code-dada-ourka",
    status: "blocked",
    reason: "dCode 页面仅提供位图/字体字形，缺少可核验的权威文本或 Unicode 映射；按任务规则不猜测。",
  },
  {
    cat: "symbols",
    name: "Code des Signaux Maritimes",
    slug: "code-signal-maritime",
    url: "https://www.dcode.fr/code-signal-maritime",
    status: "mapped",
    op: "marineFlags",
    note: "主工具箱国际信号旗",
  },
  {
    cat: "symbols",
    name: "Code du Copiale",
    slug: "code-copiale",
    url: "https://www.dcode.fr/code-copiale",
    status: "blocked",
    reason: "原文未破译或符号集无公认映射，任何替换表都是猜测。",
  },
  {
    cat: "symbols",
    name: "Dingbats ITC Zapf",
    slug: "dingbats-itc-zapf",
    url: "https://www.dcode.fr/dingbats-itc-zapf",
    status: "mapped",
    op: "wingdings",
    note: "font=zapf",
  },
  {
    cat: "symbols",
    name: "Dominos en Chiffres",
    slug: "lecteur-domino",
    url: "https://www.dcode.fr/lecteur-domino",
    status: "mapped",
    op: "dcode-extras-2026-10/num-domino",
    note: "插件多米诺",
  },
  {
    cat: "symbols",
    name: "Ecriture Dotsies",
    slug: "ecriture-dotsies",
    url: "https://www.dcode.fr/ecriture-dotsies",
    status: "blocked",
    reason: "dCode 页面仅提供位图/字体字形，缺少可核验的权威文本或 Unicode 映射；按任务规则不猜测。",
  },
  {
    cat: "symbols",
    name: "Ecriture Elian",
    slug: "ecriture-elian",
    url: "https://www.dcode.fr/ecriture-elian",
    status: "blocked",
    reason: "存在多个互不兼容的变体，dCode 未给出唯一文本表。",
  },
  {
    cat: "symbols",
    name: "Futhark Récent ᚠᚢᚦᚬᚱᚴ",
    slug: "futhark-recent",
    url: "https://www.dcode.fr/futhark-recent",
    status: "mapped",
    op: "futhark",
    note: "variant=younger",
  },
  {
    cat: "symbols",
    name: "Gravity Falls Alchimie",
    slug: "gravity-falls-alchimie",
    url: "https://www.dcode.fr/gravity-falls-alchimie",
    status: "blocked",
    reason: "dCode 页面仅提供位图/字体字形，缺少可核验的权威文本或 Unicode 映射；按任务规则不猜测。",
  },
  {
    cat: "symbols",
    name: "Gravity Falls Bill Crypto",
    slug: "gravity-falls-bill-crypto",
    url: "https://www.dcode.fr/gravity-falls-bill-crypto",
    status: "blocked",
    reason: "dCode 页面仅提供位图/字体字形，缺少可核验的权威文本或 Unicode 映射；按任务规则不猜测。",
  },
  {
    cat: "symbols",
    name: "Gravity Falls Code Couleurs",
    slug: "gravity-falls-couleurs",
    url: "https://www.dcode.fr/gravity-falls-couleurs",
    status: "blocked",
    reason: "dCode 页面仅提供位图/字体字形，缺少可核验的权威文本或 Unicode 映射；按任务规则不猜测。",
  },
  {
    cat: "symbols",
    name: "Gravity Falls Code des Frères",
    slug: "gravity-falls-code-freres",
    url: "https://www.dcode.fr/gravity-falls-code-freres",
    status: "blocked",
    reason: "dCode 页面仅提供位图/字体字形，缺少可核验的权威文本或 Unicode 映射；按任务规则不猜测。",
  },
  {
    cat: "symbols",
    name: "Gravity Falls Journal 3",
    slug: "gravity-falls-journal-3",
    url: "https://www.dcode.fr/gravity-falls-journal-3",
    status: "blocked",
    reason: "dCode 页面仅提供位图/字体字形，缺少可核验的权威文本或 Unicode 映射；按任务规则不猜测。",
  },
  {
    cat: "symbols",
    name: "Gravity Falls L'Auteur",
    slug: "gravity-falls-auteur",
    url: "https://www.dcode.fr/gravity-falls-auteur",
    status: "blocked",
    reason: "dCode 页面仅提供位图/字体字形，缺少可核验的权威文本或 Unicode 映射；按任务规则不猜测。",
  },
  {
    cat: "symbols",
    name: "Gravity Falls Rune",
    slug: "gravity-falls-rune",
    url: "https://www.dcode.fr/gravity-falls-rune",
    status: "blocked",
    reason: "dCode 页面仅提供位图/字体字形，缺少可核验的权威文本或 Unicode 映射；按任务规则不猜测。",
  },
  {
    cat: "symbols",
    name: "Gravity Falls Theraprism",
    slug: "gravity-falls-theraprisme",
    url: "https://www.dcode.fr/gravity-falls-theraprisme",
    status: "blocked",
    reason: "dCode 页面仅提供位图/字体字形，缺少可核验的权威文本或 Unicode 映射；按任务规则不猜测。",
  },
  {
    cat: "symbols",
    name: "Hexahue",
    slug: "chiffre-hexahue",
    url: "https://www.dcode.fr/chiffre-hexahue",
    status: "blocked",
    reason: "dCode 页面仅提供位图/字体字形，缺少可核验的权威文本或 Unicode 映射；按任务规则不猜测。",
  },
  {
    cat: "symbols",
    name: "Hiéroglyphes (Manuel de Codage)",
    slug: "hieroglyphes-manuel-de-codage",
    url: "https://www.dcode.fr/hieroglyphes-manuel-de-codage",
    status: "mapped",
    op: "hieroglyphs",
    note: "主工具箱 MdC",
  },
  {
    cat: "symbols",
    name: "Horloge Sémaphore",
    slug: "horloge-semaphore",
    url: "https://www.dcode.fr/horloge-semaphore",
    status: "blocked",
    reason: "输入为图像/手势/乐谱/字体渲染，需图像识别或字体 cmap，纯文本 op 无法忠实处理。",
  },
  {
    cat: "symbols",
    name: "Idéogrammes (Traits, Ronds, Points)",
    slug: "ideogrammes",
    url: "https://www.dcode.fr/ideogrammes",
    status: "blocked",
    reason: "dCode 页面仅提供位图/字体字形，缺少可核验的权威文本或 Unicode 映射；按任务规则不猜测。",
  },
  {
    cat: "symbols",
    name: "Langage Abyss (Genshin Impact)",
    slug: "langage-abyss-genshin-impact",
    url: "https://www.dcode.fr/langage-abyss-genshin-impact",
    status: "blocked",
    reason: "dCode 页面仅提供位图/字体字形，缺少可核验的权威文本或 Unicode 映射；按任务规则不猜测。",
  },
  {
    cat: "symbols",
    name: "Langage Al Bhed",
    slug: "langage-al-bhed-final-fantasy",
    url: "https://www.dcode.fr/langage-al-bhed-final-fantasy",
    status: "implemented",
    op: "d1-albhed",
  },
  {
    cat: "symbols",
    name: "Langage Alien ⏃⌰⟟⟒⋏",
    slug: "langage-alien",
    url: "https://www.dcode.fr/langage-alien",
    status: "mapped",
    op: "alienAlphabet",
    note: "mode unicode",
  },
  {
    cat: "symbols",
    name: "Langage Amharique",
    slug: "langage-amharique",
    url: "https://www.dcode.fr/langage-amharique",
    status: "blocked",
    reason: "自然语言翻译/音译，非确定性密码，需词典或联网。",
  },
  {
    cat: "symbols",
    name: "Langage Covenant (Halo)",
    slug: "langage-covenant-halo",
    url: "https://www.dcode.fr/langage-covenant-halo",
    status: "blocked",
    reason: "dCode 页面仅提供位图/字体字形，缺少可核验的权威文本或 Unicode 映射；按任务规则不猜测。",
  },
  {
    cat: "symbols",
    name: "Langage Deshret (Genshin Impact)",
    slug: "langage-deshret-genshin-impact",
    url: "https://www.dcode.fr/langage-deshret-genshin-impact",
    status: "blocked",
    reason: "dCode 页面仅提供位图/字体字形，缺少可核验的权威文本或 Unicode 映射；按任务规则不猜测。",
  },
  {
    cat: "symbols",
    name: "Langage Dovahzul",
    slug: "dovahzul-langage-dragons",
    url: "https://www.dcode.fr/dovahzul-langage-dragons",
    status: "blocked",
    reason: "自然语言翻译/音译，非确定性密码，需词典或联网。",
  },
  {
    cat: "symbols",
    name: "Langage Draconique",
    slug: "draconique-langage-dragons",
    url: "https://www.dcode.fr/draconique-langage-dragons",
    status: "blocked",
    reason: "dCode 页面仅提供位图/字体字形，缺少可核验的权威文本或 Unicode 映射；按任务规则不猜测。",
  },
  {
    cat: "symbols",
    name: "Langage Enderwalk",
    slug: "langage-enderwalk",
    url: "https://www.dcode.fr/langage-enderwalk",
    status: "blocked",
    reason: "dCode 页面仅提供位图/字体字形，缺少可核验的权威文本或 Unicode 映射；按任务规则不猜测。",
  },
  {
    cat: "symbols",
    name: "Langage Gerudo",
    slug: "langage-gerudo",
    url: "https://www.dcode.fr/langage-gerudo",
    status: "blocked",
    reason: "dCode 页面仅提供位图/字体字形，缺少可核验的权威文本或 Unicode 映射；按任务规则不猜测。",
  },
  {
    cat: "symbols",
    name: "Langage Goron",
    slug: "langage-goron",
    url: "https://www.dcode.fr/langage-goron",
    status: "blocked",
    reason: "dCode 页面仅提供位图/字体字形，缺少可核验的权威文本或 Unicode 映射；按任务规则不猜测。",
  },
  {
    cat: "symbols",
    name: "Langage Hylian (A Link Between Worlds)",
    slug: "langage-hylian-a-link-between-worlds",
    url: "https://www.dcode.fr/langage-hylian-a-link-between-worlds",
    status: "blocked",
    reason: "dCode 页面仅提供位图/字体字形，缺少可核验的权威文本或 Unicode 映射；按任务规则不猜测。",
  },
  {
    cat: "symbols",
    name: "Langage Hylian (Breath of the Wild)",
    slug: "langage-hylian-breath-of-the-wild",
    url: "https://www.dcode.fr/langage-hylian-breath-of-the-wild",
    status: "blocked",
    reason: "dCode 页面仅提供位图/字体字形，缺少可核验的权威文本或 Unicode 映射；按任务规则不猜测。",
  },
  {
    cat: "symbols",
    name: "Langage Hylian (Skyward Sword)",
    slug: "langage-hylian-skyward-sword",
    url: "https://www.dcode.fr/langage-hylian-skyward-sword",
    status: "blocked",
    reason: "dCode 页面仅提供位图/字体字形，缺少可核验的权威文本或 Unicode 映射；按任务规则不猜测。",
  },
  {
    cat: "symbols",
    name: "Langage Hylian (The Wind Waker)",
    slug: "langage-hylian-the-wind-waker",
    url: "https://www.dcode.fr/langage-hylian-the-wind-waker",
    status: "blocked",
    reason: "dCode 页面仅提供位图/字体字形，缺少可核验的权威文本或 Unicode 映射；按任务规则不猜测。",
  },
  {
    cat: "symbols",
    name: "Langage Hylian (Twilight Princess)",
    slug: "langage-hylian-twilight-princess",
    url: "https://www.dcode.fr/langage-hylian-twilight-princess",
    status: "blocked",
    reason: "dCode 页面仅提供位图/字体字形，缺少可核验的权威文本或 Unicode 映射；按任务规则不猜测。",
  },
  {
    cat: "symbols",
    name: "Langage Hylien (Ocarina of Time)",
    slug: "langage-hylien-ocarina-of-time",
    url: "https://www.dcode.fr/langage-hylien-ocarina-of-time",
    status: "blocked",
    reason: "dCode 页面仅提供位图/字体字形，缺少可核验的权威文本或 Unicode 映射；按任务规则不猜测。",
  },
  {
    cat: "symbols",
    name: "Langage Inazuman (Genshin Impact)",
    slug: "langage-inazuman-genshin-impact",
    url: "https://www.dcode.fr/langage-inazuman-genshin-impact",
    status: "blocked",
    reason: "dCode 页面仅提供位图/字体字形，缺少可核验的权威文本或 Unicode 映射；按任务规则不猜测。",
  },
  {
    cat: "symbols",
    name: "Langage Inuktitut",
    slug: "langage-inuktitut",
    url: "https://www.dcode.fr/langage-inuktitut",
    status: "blocked",
    reason: "自然语言翻译/音译，非确定性密码，需词典或联网。",
  },
  {
    cat: "symbols",
    name: "Langage Iokharique",
    slug: "langage-iokharique",
    url: "https://www.dcode.fr/langage-iokharique",
    status: "blocked",
    reason: "dCode 页面仅提供位图/字体字形，缺少可核验的权威文本或 Unicode 映射；按任务规则不猜测。",
  },
  {
    cat: "symbols",
    name: "Langage Klingon (pIqaD)",
    slug: "langage-klingon",
    url: "https://www.dcode.fr/langage-klingon",
    status: "mapped",
    op: "dcode-extras-2026-10/sym-klingon",
    note: "插件克林贡 pIqaD",
  },
  {
    cat: "symbols",
    name: "Langage Matoran",
    slug: "langage-matoran",
    url: "https://www.dcode.fr/langage-matoran",
    status: "blocked",
    reason: "dCode 页面仅提供位图/字体字形，缺少可核验的权威文本或 Unicode 映射；按任务规则不猜测。",
  },
  {
    cat: "symbols",
    name: "Langage Sheikah",
    slug: "langage-sheikah",
    url: "https://www.dcode.fr/langage-sheikah",
    status: "blocked",
    reason: "dCode 页面仅提供位图/字体字形，缺少可核验的权威文本或 Unicode 映射；按任务规则不猜测。",
  },
  {
    cat: "symbols",
    name: "Langage Simlish",
    slug: "langage-simlish",
    url: "https://www.dcode.fr/langage-simlish",
    status: "blocked",
    reason: "dCode 页面仅提供位图/字体字形，缺少可核验的权威文本或 Unicode 映射；按任务规则不猜测。",
  },
  {
    cat: "symbols",
    name: "Langage Sumeru (Genshin Impact)",
    slug: "langage-sumeru-genshin-impact",
    url: "https://www.dcode.fr/langage-sumeru-genshin-impact",
    status: "blocked",
    reason: "dCode 页面仅提供位图/字体字形，缺少可核验的权威文本或 Unicode 映射；按任务规则不猜测。",
  },
  {
    cat: "symbols",
    name: "Langage Teyvat (Genshin Impact)",
    slug: "langage-teyvat-genshin-impact",
    url: "https://www.dcode.fr/langage-teyvat-genshin-impact",
    status: "blocked",
    reason: "dCode 页面仅提供位图/字体字形，缺少可核验的权威文本或 Unicode 映射；按任务规则不猜测。",
  },
  {
    cat: "symbols",
    name: "Langage Vulcain (Star Trek)",
    slug: "langage-vulcain",
    url: "https://www.dcode.fr/langage-vulcain",
    status: "blocked",
    reason: "dCode 页面仅提供位图/字体字形，缺少可核验的权威文本或 Unicode 映射；按任务规则不猜测。",
  },
  {
    cat: "symbols",
    name: "Langue Atlante",
    slug: "langue-atlante",
    url: "https://www.dcode.fr/langue-atlante",
    status: "blocked",
    reason: "dCode 页面仅提供位图/字体字形，缺少可核验的权威文本或 Unicode 映射；按任务规则不猜测。",
  },
  {
    cat: "symbols",
    name: "Langue Gnomique",
    slug: "alphabet-gnomique",
    url: "https://www.dcode.fr/alphabet-gnomique",
    status: "blocked",
    reason: "dCode 页面仅提供位图/字体字形，缺少可核验的权威文本或 Unicode 映射；按任务规则不猜测。",
  },
  {
    cat: "symbols",
    name: "Langue des Signes Américaine",
    slug: "langue-des-signes-americaine",
    url: "https://www.dcode.fr/langue-des-signes-americaine",
    status: "blocked",
    reason: "输入为图像/手势/乐谱/字体渲染，需图像识别或字体 cmap，纯文本 op 无法忠实处理。",
  },
  {
    cat: "symbols",
    name: "Langue des Signes Française",
    slug: "langue-des-signes-francaise",
    url: "https://www.dcode.fr/langue-des-signes-francaise",
    status: "blocked",
    reason: "输入为图像/手势/乐谱/字体渲染，需图像识别或字体 cmap，纯文本 op 无法忠实处理。",
  },
  {
    cat: "symbols",
    name: "Lingua Ignota",
    slug: "code-lingua-ignota",
    url: "https://www.dcode.fr/code-lingua-ignota",
    status: "blocked",
    reason: "自然语言翻译/音译，非确定性密码，需词典或联网。",
  },
  {
    cat: "symbols",
    name: "Malayalam മലയാളം",
    slug: "langue-malayalam",
    url: "https://www.dcode.fr/langue-malayalam",
    status: "blocked",
    reason: "自然语言翻译/音译，非确定性密码，需词典或联网。",
  },
  {
    cat: "symbols",
    name: "Marquage Alpha Angle",
    slug: "marquage-alpha-angle",
    url: "https://www.dcode.fr/marquage-alpha-angle",
    status: "blocked",
    reason: "dCode 页面仅提供位图/字体字形，缺少可核验的权威文本或 Unicode 映射；按任务规则不猜测。",
  },
  {
    cat: "symbols",
    name: "Marques de Dénombrement",
    slug: "marques-unaires",
    url: "https://www.dcode.fr/marques-unaires",
    status: "mapped",
    op: "dcode-extras-2026-10/num-tally",
    note: "插件计数刻痕",
  },
  {
    cat: "symbols",
    name: "New Alphabet de Crouwel",
    slug: "new-alphabet-wim-crouwel",
    url: "https://www.dcode.fr/new-alphabet-wim-crouwel",
    status: "blocked",
    reason: "dCode 页面仅提供位图/字体字形，缺少可核验的权威文本或 Unicode 映射；按任务规则不猜测。",
  },
  {
    cat: "symbols",
    name: "Nombres Kaktovik",
    slug: "numeration-kaktovik",
    url: "https://www.dcode.fr/numeration-kaktovik",
    status: "mapped",
    op: "dcode-extras-2026-10/num-kaktovik",
    note: "插件 Kaktovik",
  },
  {
    cat: "symbols",
    name: "Nombres des Moines Cisterciens",
    slug: "nombres-cisterciens",
    url: "https://www.dcode.fr/nombres-cisterciens",
    status: "mapped",
    op: "dcode-extras-2026-10/num-cistercian",
    note: "插件西多会数字",
  },
  {
    cat: "symbols",
    name: "Notation des Noeuds",
    slug: "notation-noeuds",
    url: "https://www.dcode.fr/notation-noeuds",
    status: "blocked",
    reason: "参考/索引/文档类工具，不是可逆编码算法。",
  },
  {
    cat: "symbols",
    name: "Numération Babylonienne",
    slug: "nombres-babyloniens",
    url: "https://www.dcode.fr/nombres-babyloniens",
    status: "mapped",
    op: "babylonianNumerals",
    note: "主工具箱巴比伦数字",
  },
  {
    cat: "symbols",
    name: "Numération D'ni",
    slug: "numeration-dni",
    url: "https://www.dcode.fr/numeration-dni",
    status: "blocked",
    reason: "dCode 页面仅提供位图/字体字形，缺少可核验的权威文本或 Unicode 映射；按任务规则不猜测。",
  },
  {
    cat: "symbols",
    name: "Numération Egyptienne",
    slug: "numeration-egyptienne",
    url: "https://www.dcode.fr/numeration-egyptienne",
    status: "mapped",
    op: "egyptianNumerals",
    note: "主工具箱埃及数字",
  },
  {
    cat: "symbols",
    name: "Numération Maya",
    slug: "nombres-mayas",
    url: "https://www.dcode.fr/nombres-mayas",
    status: "mapped",
    op: "mayaNumerals",
    note: "主工具箱玛雅数字",
  },
  {
    cat: "symbols",
    name: "Nyctographie Lewis Carroll",
    slug: "nyctographie-lewis-carroll",
    url: "https://www.dcode.fr/nyctographie-lewis-carroll",
    status: "blocked",
    reason: "dCode 页面仅提供位图/字体字形，缺少可核验的权威文本或 Unicode 映射；按任务规则不猜测。",
  },
  {
    cat: "symbols",
    name: "Partition/Portée de Musique",
    slug: "partition-musique",
    url: "https://www.dcode.fr/partition-musique",
    status: "blocked",
    reason: "输入为图像/手势/乐谱/字体渲染，需图像识别或字体 cmap，纯文本 op 无法忠实处理。",
  },
  {
    cat: "symbols",
    name: "Police Symbol",
    slug: "police-symbol",
    url: "https://www.dcode.fr/police-symbol",
    status: "blocked",
    reason: "商业字体 cmap/字形版权限制，无随项目分发的忠实映射。",
  },
  {
    cat: "symbols",
    name: "Police Webdings",
    slug: "police-webdings",
    url: "https://www.dcode.fr/police-webdings",
    status: "blocked",
    reason: "商业字体 cmap/字形版权限制，无随项目分发的忠实映射。",
  },
  {
    cat: "symbols",
    name: "Police Wingdings",
    slug: "police-wingdings",
    url: "https://www.dcode.fr/police-wingdings",
    status: "mapped",
    op: "wingdings",
    note: "font=wingdings1",
  },
  {
    cat: "symbols",
    name: "Police Wingdings 2",
    slug: "police-wingdings-2",
    url: "https://www.dcode.fr/police-wingdings-2",
    status: "mapped",
    op: "wingdings",
    note: "font=wingdings2",
  },
  {
    cat: "symbols",
    name: "Police Wingdings 3",
    slug: "police-wingdings-3",
    url: "https://www.dcode.fr/police-wingdings-3",
    status: "mapped",
    op: "wingdings",
    note: "font=wingdings3",
  },
  {
    cat: "symbols",
    name: "Sanskrit संस्कृतम्",
    slug: "langue-sanskrit",
    url: "https://www.dcode.fr/langue-sanskrit",
    status: "blocked",
    reason: "自然语言翻译/音译，非确定性密码，需词典或联网。",
  },
  {
    cat: "symbols",
    name: "Signe Astrologique",
    slug: "signe-astrologique",
    url: "https://www.dcode.fr/signe-astrologique",
    status: "mapped",
    op: "astroSymbols",
    note: "set=zodiac",
  },
  {
    cat: "symbols",
    name: "Symboles Astronomiques",
    slug: "symboles-astronomiques",
    url: "https://www.dcode.fr/symboles-astronomiques",
    status: "mapped",
    op: "astroSymbols",
    note: "set=planets",
  },
  {
    cat: "symbols",
    name: "Thaï ภาษาไทย",
    slug: "langue-thai",
    url: "https://www.dcode.fr/langue-thai",
    status: "blocked",
    reason: "自然语言翻译/音译，非确定性密码，需词典或联网。",
  },
  {
    cat: "symbols",
    name: "Télougou తెలుగు",
    slug: "langue-telougou",
    url: "https://www.dcode.fr/langue-telougou",
    status: "blocked",
    reason: "自然语言翻译/音译，非确定性密码，需词典或联网。",
  },
  {
    cat: "symbols",
    name: "Vieux Futhark ᚠᚢᚦᚨᚱᚲ",
    slug: "vieux-futhark",
    url: "https://www.dcode.fr/vieux-futhark",
    status: "mapped",
    op: "futhark",
    note: "variant=elder",
  },
  {
    cat: "symbols",
    name: "ALT-Codes",
    slug: "convertisseur-alt-codes",
    url: "https://www.dcode.fr/convertisseur-alt-codes",
    status: "mapped",
    op: "dcode-extras-2026-10/sym-altcodes",
    note: "插件 Alt 码",
  },
  {
    cat: "symbols",
    name: "Alphabet Phonétique de l'OTAN",
    slug: "alphabet-phonetique-otan",
    url: "https://www.dcode.fr/alphabet-phonetique-otan",
    status: "mapped",
    op: "natoAlphabet",
    note: "主工具箱 NATO",
  },
  {
    cat: "symbols",
    name: "Appui Long sur Clavier Android",
    slug: "clavier-android-appui-long",
    url: "https://www.dcode.fr/clavier-android-appui-long",
    status: "blocked",
    reason: "存在多个互不兼容的变体，dCode 未给出唯一文本表。",
  },
  {
    cat: "symbols",
    name: "Ave Maria de Trithème",
    slug: "ave-maria-tritheme",
    url: "https://www.dcode.fr/ave-maria-tritheme",
    status: "mapped",
    op: "trithemius",
    note: "主工具箱 Ave Maria",
  },
  {
    cat: "symbols",
    name: "Base100 💯",
    slug: "code-base100-emoji",
    url: "https://www.dcode.fr/code-base100-emoji",
    status: "mapped",
    op: "base100",
    note: "主工具箱 Base100",
  },
  {
    cat: "symbols",
    name: "Caractères de Controles ASCII",
    slug: "caracteres-controle-ascii",
    url: "https://www.dcode.fr/caracteres-controle-ascii",
    status: "implemented",
    op: "d1-ascii-controls",
  },
  {
    cat: "symbols",
    name: "Chiffre ADFGVX",
    slug: "chiffre-adfgvx",
    url: "https://www.dcode.fr/chiffre-adfgvx",
    status: "mapped",
    op: "adfgvx",
    note: "主工具箱 ADFGVX",
  },
  {
    cat: "symbols",
    name: "Chiffre ADFGX",
    slug: "chiffre-adfgx",
    url: "https://www.dcode.fr/chiffre-adfgx",
    status: "mapped",
    op: "adfgx",
    note: "主工具箱 ADFGX",
  },
  {
    cat: "symbols",
    name: "Chiffre Affine",
    slug: "chiffre-affine",
    url: "https://www.dcode.fr/chiffre-affine",
    status: "mapped",
    op: "affine",
    note: "主工具箱仿射",
  },
  {
    cat: "symbols",
    name: "Chiffre Atbash",
    slug: "chiffre-atbash",
    url: "https://www.dcode.fr/chiffre-atbash",
    status: "mapped",
    op: "atbash",
    note: "主工具箱 Atbash",
  },
  {
    cat: "symbols",
    name: "Chiffre Bazeries",
    slug: "chiffre-bazeries",
    url: "https://www.dcode.fr/chiffre-bazeries",
    status: "mapped",
    op: "bazeries",
    note: "主工具箱 Bazeries",
  },
  {
    cat: "symbols",
    name: "Chiffre Décalage ASCII",
    slug: "chiffre-decalage-ascii",
    url: "https://www.dcode.fr/chiffre-decalage-ascii",
    status: "implemented",
    op: "d1-ascii-shift",
  },
  {
    cat: "symbols",
    name: "Chiffre Monome-Binome",
    slug: "chiffre-monome-binome",
    url: "https://www.dcode.fr/chiffre-monome-binome",
    status: "mapped",
    op: "monomeBinome",
    note: "主工具箱 Monome-Binome",
  },
  {
    cat: "symbols",
    name: "Chiffre Multiplication Nombres Premiers",
    slug: "chiffre-multiplication-nombres-premiers",
    url: "https://www.dcode.fr/chiffre-multiplication-nombres-premiers",
    status: "implemented",
    op: "d1-prime-mult",
    note: "mode1/mode4；mode2/mode3 不实现",
  },
  {
    cat: "symbols",
    name: "Chiffre ROT (Rotation)",
    slug: "chiffre-rot",
    url: "https://www.dcode.fr/chiffre-rot",
    status: "mapped",
    op: "rotSpecial",
    note: "主工具箱通用 ROT",
  },
  {
    cat: "symbols",
    name: "Chiffre ROT-5",
    slug: "chiffre-rot5",
    url: "https://www.dcode.fr/chiffre-rot5",
    status: "mapped",
    op: "rot5",
    note: "主工具箱 ROT-5",
  },
  {
    cat: "symbols",
    name: "Chiffre ROT-13",
    slug: "chiffre-rot-13",
    url: "https://www.dcode.fr/chiffre-rot-13",
    status: "mapped",
    op: "rot13",
    note: "主工具箱 ROT-13",
  },
  {
    cat: "symbols",
    name: "Chiffre ROT-18",
    slug: "chiffre-rot18",
    url: "https://www.dcode.fr/chiffre-rot18",
    status: "mapped",
    op: "rot18",
    note: "主工具箱 ROT-18",
  },
  {
    cat: "symbols",
    name: "Chiffre ROT-47",
    slug: "chiffre-rot-47",
    url: "https://www.dcode.fr/chiffre-rot-47",
    status: "mapped",
    op: "rot47",
    note: "主工具箱 ROT-47",
  },
  {
    cat: "symbols",
    name: "Chiffre ROT1",
    slug: "chiffre-rot1",
    url: "https://www.dcode.fr/chiffre-rot1",
    status: "mapped",
    op: "caesar",
    note: "shift=1",
  },
  {
    cat: "symbols",
    name: "Chiffre ROT8000",
    slug: "chiffre-rot8000",
    url: "https://www.dcode.fr/chiffre-rot8000",
    status: "mapped",
    op: "rot8000",
    note: "主工具箱 ROT8000",
  },
  {
    cat: "symbols",
    name: "Chiffre Rozier",
    slug: "chiffre-rozier",
    url: "https://www.dcode.fr/chiffre-rozier",
    status: "implemented",
    op: "d1-rozier",
  },
  {
    cat: "symbols",
    name: "Chiffre Trilitère",
    slug: "chiffre-trilitere",
    url: "https://www.dcode.fr/chiffre-trilitere",
    status: "mapped",
    op: "trilitere",
    note: "主工具箱三字母",
  },
  {
    cat: "symbols",
    name: "Chiffre Twin Hex",
    slug: "chiffre-twin-hex",
    url: "https://www.dcode.fr/chiffre-twin-hex",
    status: "mapped",
    op: "twinHex",
    note: "主工具箱 Twin Hex",
  },
  {
    cat: "symbols",
    name: "Chiffre VIC",
    slug: "chiffre-vic",
    url: "https://www.dcode.fr/chiffre-vic",
    status: "mapped",
    op: "vic",
    note: "主工具箱 VIC",
  },
  {
    cat: "symbols",
    name: "Chiffre Wolseley",
    slug: "chiffre-wolseley",
    url: "https://www.dcode.fr/chiffre-wolseley",
    status: "implemented",
    op: "d1-wolseley",
  },
  {
    cat: "symbols",
    name: "Chiffre de Bacon (Bilitere)",
    slug: "chiffre-bacon-bilitere",
    url: "https://www.dcode.fr/chiffre-bacon-bilitere",
    status: "mapped",
    op: "bacon",
    note: "主工具箱培根",
  },
  {
    cat: "symbols",
    name: "Chiffre de Polybe",
    slug: "chiffre-polybe",
    url: "https://www.dcode.fr/chiffre-polybe",
    status: "mapped",
    op: "polybius",
    note: "主工具箱波利比奥斯",
  },
  {
    cat: "symbols",
    name: "Chiffrement Multiplicatif",
    slug: "chiffrement-multiplicatif",
    url: "https://www.dcode.fr/chiffrement-multiplicatif",
    status: "mapped",
    op: "affine",
    note: "b=0 的仿射",
  },
  {
    cat: "symbols",
    name: "Chiffre par Décalages",
    slug: "chiffre-decalages",
    url: "https://www.dcode.fr/chiffre-decalages",
    status: "implemented",
    op: "d1-progressive-caesar",
  },
  {
    cat: "symbols",
    name: "Chiffre par Livre",
    slug: "chiffre-livre",
    url: "https://www.dcode.fr/chiffre-livre",
    status: "mapped",
    op: "bookCipher",
    note: "主工具箱书本密码",
  },
  {
    cat: "symbols",
    name: "Chiffre par Rang Consonnes/Voyelles",
    slug: "chiffre-rang-consonnes-voyelles",
    url: "https://www.dcode.fr/chiffre-rang-consonnes-voyelles",
    status: "implemented",
    op: "d1-cv-rank",
  },
  {
    cat: "symbols",
    name: "Chiffre par Substitution",
    slug: "chiffre-substitution",
    url: "https://www.dcode.fr/chiffre-substitution",
    status: "mapped",
    op: "simplesub",
    note: "主工具箱单表替换",
  },
  {
    cat: "symbols",
    name: "Chiffres Gravity Falls",
    slug: "chiffres-gravity-falls",
    url: "https://www.dcode.fr/chiffres-gravity-falls",
    status: "blocked",
    reason: "dCode 页面仅提供位图/字体字形，缺少可核验的权威文本或 Unicode 映射；按任务规则不猜测。",
  },
  {
    cat: "symbols",
    name: "Clavier JIS (みかか Mikaka)",
    slug: "clavier-jis-mikaka",
    url: "https://www.dcode.fr/clavier-jis-mikaka",
    status: "blocked",
    reason: "存在多个互不兼容的变体，dCode 未给出唯一文本表。",
  },
  {
    cat: "symbols",
    name: "Code Alphabet Numéroté (A1Z26) A=1, B=2, C=3",
    slug: "rang-alphabetique",
    url: "https://www.dcode.fr/rang-alphabetique",
    status: "mapped",
    op: "a1z26",
    note: "主工具箱 A1Z26",
  },
  {
    cat: "symbols",
    name: "Code Braille GS8",
    slug: "code-braille-gs8",
    url: "https://www.dcode.fr/code-braille-gs8",
    status: "mapped",
    op: "dcode-extras-2026-10/sym-braille-gs8",
    note: "插件 GS8 盲文",
  },
  {
    cat: "symbols",
    name: "Code Cassette K7",
    slug: "code-k7-cassette",
    url: "https://www.dcode.fr/code-k7-cassette",
    status: "implemented",
    op: "d1-rank-anchor",
    note: "anchor=K,value=7,cyclic",
  },
  {
    cat: "symbols",
    name: "Code Cassis K6",
    slug: "code-k6-cassis",
    url: "https://www.dcode.fr/code-k6-cassis",
    status: "implemented",
    op: "d1-rank-anchor",
    note: "anchor=K,value=6,cyclic",
  },
  {
    cat: "symbols",
    name: "Code César",
    slug: "chiffre-cesar",
    url: "https://www.dcode.fr/chiffre-cesar",
    status: "mapped",
    op: "caesar",
    note: "主工具箱凯撒",
  },
  {
    cat: "symbols",
    name: "Code DTMF (FV)",
    slug: "code-dtmf",
    url: "https://www.dcode.fr/code-dtmf",
    status: "mapped",
    op: "dtmf",
    note: "主工具箱 DTMF",
  },
  {
    cat: "symbols",
    name: "Code Détroit D3",
    slug: "code-d3-detroit",
    url: "https://www.dcode.fr/code-d3-detroit",
    status: "implemented",
    op: "d1-rank-anchor",
    note: "anchor=D,value=3,cyclic",
  },
  {
    cat: "symbols",
    name: "Code Indienne",
    slug: "code-indienne",
    url: "https://www.dcode.fr/code-indienne",
    status: "implemented",
    op: "d1-rank-anchor",
    note: "anchor=N,value=1,cyclic",
  },
  {
    cat: "symbols",
    name: "Code Morse",
    slug: "code-morse",
    url: "https://www.dcode.fr/code-morse",
    status: "mapped",
    op: "morse",
    note: "主工具箱摩斯",
  },
  {
    cat: "symbols",
    name: "Code Morse Fractionné",
    slug: "code-morse-fractionne",
    url: "https://www.dcode.fr/code-morse-fractionne",
    status: "mapped",
    op: "fracmorse",
    note: "主工具箱分数摩斯",
  },
  {
    cat: "symbols",
    name: "Code Nak Nak",
    slug: "code-nak-nak",
    url: "https://www.dcode.fr/code-nak-nak",
    status: "implemented",
    op: "d1-naknak",
  },
  {
    cat: "symbols",
    name: "Code Navajo",
    slug: "code-navajo",
    url: "https://www.dcode.fr/code-navajo",
    status: "blocked",
    reason: "依赖 dCode 未公开或需同版本外部码本（词表、页码、共版书籍），无法离线确定性复现。",
  },
  {
    cat: "symbols",
    name: "Code T9 (SMS)",
    slug: "code-t9",
    url: "https://www.dcode.fr/code-t9",
    status: "mapped",
    op: "t9Phone",
    note: "主工具箱 T9",
  },
  {
    cat: "symbols",
    name: "Code Touches Javascript",
    slug: "code-touches-javascript",
    url: "https://www.dcode.fr/code-touches-javascript",
    status: "mapped",
    op: "keyCode",
    note: "主工具箱 JS keyCode",
  },
  {
    cat: "symbols",
    name: "Code Wabun",
    slug: "code-wabun",
    url: "https://www.dcode.fr/code-wabun",
    status: "mapped",
    op: "wabun",
    note: "主工具箱 Wabun",
  },
  {
    cat: "symbols",
    name: "Code de Clavier de Téléphone",
    slug: "code-clavier-telephone",
    url: "https://www.dcode.fr/code-clavier-telephone",
    status: "mapped",
    op: "t9Phone",
    note: "主工具箱电话键盘",
  },
  {
    cat: "symbols",
    name: "Code à Cris (Scream ÃA̧ȂÁAǍ)",
    slug: "code-cris-xkcd",
    url: "https://www.dcode.fr/code-cris-xkcd",
    status: "implemented",
    op: "d1-scream",
  },
  {
    cat: "symbols",
    name: "Conversion de Clavier",
    slug: "chiffre-changement-clavier",
    url: "https://www.dcode.fr/chiffre-changement-clavier",
    status: "mapped",
    op: "layoutMap",
    note: "主工具箱键盘布局映射",
  },
  {
    cat: "symbols",
    name: "Coordonnées de Grille",
    slug: "coordonnees-grille",
    url: "https://www.dcode.fr/coordonnees-grille",
    status: "blocked",
    reason: "dCode 是通用可配置网格读取器，不是固定密码，没有唯一映射可复现。",
  },
  {
    cat: "symbols",
    name: "Coordonnées des Touches de Clavier",
    slug: "coordonnees-clavier",
    url: "https://www.dcode.fr/coordonnees-clavier",
    status: "mapped",
    op: "keyboardSurround",
    note: "mode=coord",
  },
  {
    cat: "symbols",
    name: "Dessin sur Clavier Numérique",
    slug: "dessin-clavier-numerique",
    url: "https://www.dcode.fr/dessin-clavier-numerique",
    status: "blocked",
    reason: "需要 dCode 专用 3x3 点阵字形表（完整表未公开），无法可靠映射。",
  },
  {
    cat: "symbols",
    name: "Disque Chiffrant",
    slug: "disque-chiffrant",
    url: "https://www.dcode.fr/disque-chiffrant",
    status: "mapped",
    op: "alberti",
    note: "主工具箱 Alberti 盘",
  },
  {
    cat: "symbols",
    name: "Décalage Clavier",
    slug: "chiffre-decalage-clavier",
    url: "https://www.dcode.fr/chiffre-decalage-clavier",
    status: "mapped",
    op: "keyboardShift",
    note: "主工具箱键盘漂移",
  },
  {
    cat: "symbols",
    name: "Décalage Unicode",
    slug: "chiffre-decalage-unicode",
    url: "https://www.dcode.fr/chiffre-decalage-unicode",
    status: "implemented",
    op: "d1-unicode-shift",
  },
  {
    cat: "symbols",
    name: "Désubstitution/Motif de Mot",
    slug: "desubstitution-mot",
    url: "https://www.dcode.fr/desubstitution-mot",
    status: "implemented",
    op: "d1-word-pattern",
    note: "用户提供候选词表",
  },
  {
    cat: "symbols",
    name: "Ecriture LSPK90 Horaire",
    slug: "lspk90-h-leet-speak-90-degres-horaire",
    url: "https://www.dcode.fr/lspk90-h-leet-speak-90-degres-horaire",
    status: "blocked",
    reason: "dCode 页面仅提供位图/字体字形，缺少可核验的权威文本或 Unicode 映射；按任务规则不猜测。",
  },
  {
    cat: "symbols",
    name: "Formes de Caractères Binaires",
    slug: "binaire-forme-caractere",
    url: "https://www.dcode.fr/binaire-forme-caractere",
    status: "blocked",
    reason: "存在多个互不兼容的变体，dCode 未给出唯一文本表。",
  },
  {
    cat: "symbols",
    name: "Langage Hodor",
    slug: "langage-hodor",
    url: "https://www.dcode.fr/langage-hodor",
    status: "blocked",
    reason: "自然语言翻译/音译，非确定性密码，需词典或联网。",
  },
  {
    cat: "symbols",
    name: "Langage de Kenny (Southpark)",
    slug: "code-kenny-southpark",
    url: "https://www.dcode.fr/code-kenny-southpark",
    status: "mapped",
    op: "kenny",
    note: "主工具箱 Kenny 语",
  },
  {
    cat: "symbols",
    name: "Langage de Shankar (Slumdog Millionnaire)",
    slug: "langage-shankar",
    url: "https://www.dcode.fr/langage-shankar",
    status: "blocked",
    reason: "自然语言翻译/音译，非确定性密码，需词典或联网。",
  },
  {
    cat: "symbols",
    name: "Langages de Genshin Impact",
    slug: "langages-genshin-impact",
    url: "https://www.dcode.fr/langages-genshin-impact",
    status: "blocked",
    reason: "dCode 页面仅提供位图/字体字形，缺少可核验的权威文本或 Unicode 映射；按任务规则不猜测。",
  },
  {
    cat: "symbols",
    name: "Liste de Mots PGP",
    slug: "liste-mots-pgp",
    url: "https://www.dcode.fr/liste-mots-pgp",
    status: "blocked",
    reason: "PGP 词表是参考数据而非编码算法，词表未随项目分发。",
  },
  {
    cat: "symbols",
    name: "Malespin",
    slug: "argot-malespin",
    url: "https://www.dcode.fr/argot-malespin",
    status: "blocked",
    reason: "自然语言翻译/音译，非确定性密码，需词典或联网。",
  },
  {
    cat: "symbols",
    name: "Nombres en Dés ⚀⚁⚂",
    slug: "nombres-des",
    url: "https://www.dcode.fr/nombres-des",
    status: "mapped",
    op: "dcode-extras-2026-10/num-dice",
    note: "插件骰子数字",
  },
  {
    cat: "symbols",
    name: "Notes de Musique",
    slug: "notes-musique",
    url: "https://www.dcode.fr/notes-musique",
    status: "mapped",
    op: "musicNotation",
    note: "主工具箱音名互转",
  },
  {
    cat: "symbols",
    name: "Numéro Atomique (Table Périodique)",
    slug: "substitution-numero-atomique",
    url: "https://www.dcode.fr/substitution-numero-atomique",
    status: "mapped",
    op: "element",
    note: "主工具箱元素/原子序数",
  },
  {
    cat: "symbols",
    name: "Rang Alphabet Grec α=1, β=2, γ=3",
    slug: "rang-alphabet-grec",
    url: "https://www.dcode.fr/rang-alphabet-grec",
    status: "implemented",
    op: "d1-greek-rank",
  },
  {
    cat: "symbols",
    name: "Rang Alphabétique Additionné",
    slug: "rang-alphabetique-additionne",
    url: "https://www.dcode.fr/rang-alphabetique-additionne",
    status: "implemented",
    op: "d1-alpha-sum",
  },
  {
    cat: "symbols",
    name: "Substitution Mono-alphabétique",
    slug: "substitution-monoalphabetique",
    url: "https://www.dcode.fr/substitution-monoalphabetique",
    status: "mapped",
    op: "simplesub",
    note: "主工具箱单表替换",
  },
  {
    cat: "symbols",
    name: "Substitution par Mots",
    slug: "substitution-mots",
    url: "https://www.dcode.fr/substitution-mots",
    status: "implemented",
    op: "d1-nomenclature",
    note: "用户提供词表",
  },
  {
    cat: "symbols",
    name: "Substitution par Nombres Premiers",
    slug: "substitution-nombres-premiers",
    url: "https://www.dcode.fr/substitution-nombres-premiers",
    status: "implemented",
    op: "d1-prime-subst",
  },
  {
    cat: "symbols",
    name: "Tap Code (Chiffre Frappé)",
    slug: "chiffre-frappe-tap",
    url: "https://www.dcode.fr/chiffre-frappe-tap",
    status: "mapped",
    op: "tapCode",
    note: "主工具箱敲击码",
  },
  {
    cat: "symbols",
    name: "Transcription Alphabetique",
    slug: "transcription-alphabetique",
    url: "https://www.dcode.fr/transcription-alphabetique",
    status: "blocked",
    reason: "自然语言翻译/音译，非确定性密码，需词典或联网。",
  },
  {
    cat: "symbols",
    name: "Wetterkurzschlussel",
    slug: "codes-meteo-wetterkurzschlussel",
    url: "https://www.dcode.fr/codes-meteo-wetterkurzschlussel",
    status: "blocked",
    reason: "依赖 dCode 未公开或需同版本外部码本（词表、页码、共版书籍），无法离线确定性复现。",
  },
  {
    cat: "grid",
    name: "Chiffre ADFGX",
    slug: "chiffre-adfgx",
    url: "https://www.dcode.fr/chiffre-adfgx",
    status: "mapped",
    op: "adfgx",
    note: "主工具箱 ADFGX",
  },
  {
    cat: "grid",
    name: "Chiffre Bazeries",
    slug: "chiffre-bazeries",
    url: "https://www.dcode.fr/chiffre-bazeries",
    status: "mapped",
    op: "bazeries",
    note: "主工具箱 Bazeries",
  },
  {
    cat: "grid",
    name: "Chiffre PlayFair",
    slug: "chiffre-playfair",
    url: "https://www.dcode.fr/chiffre-playfair",
    status: "implemented",
    op: "d1-playfair",
  },
  {
    cat: "grid",
    name: "Chiffre Swagman",
    slug: "chiffre-swagman",
    url: "https://www.dcode.fr/chiffre-swagman",
    status: "implemented",
    op: "d1-swagman",
  },
  {
    cat: "grid",
    name: "Chiffre Trifide Delastelle",
    slug: "chiffre-trifide-delastelle",
    url: "https://www.dcode.fr/chiffre-trifide-delastelle",
    status: "mapped",
    op: "trifid",
    note: "主工具箱 Trifid",
  },
  {
    cat: "grid",
    name: "Chiffre VIC",
    slug: "chiffre-vic",
    url: "https://www.dcode.fr/chiffre-vic",
    status: "mapped",
    op: "vic",
    note: "主工具箱 VIC",
  },
  {
    cat: "grid",
    name: "Chiffre de Collon",
    slug: "chiffre-collon",
    url: "https://www.dcode.fr/chiffre-collon",
    status: "mapped",
    op: "collon",
    note: "主工具箱 Collon",
  },
  {
    cat: "grid",
    name: "Chiffre de Delastelle",
    slug: "chiffre-bifide-delastelle",
    url: "https://www.dcode.fr/chiffre-bifide-delastelle",
    status: "mapped",
    op: "bifid",
    note: "主工具箱 Bifid",
  },
  {
    cat: "grid",
    name: "Chiffre de Grandpré",
    slug: "chiffre-grandpre",
    url: "https://www.dcode.fr/chiffre-grandpre",
    status: "implemented",
    op: "d1-grandpre",
  },
  {
    cat: "grid",
    name: "Chiffre de Polybe",
    slug: "chiffre-polybe",
    url: "https://www.dcode.fr/chiffre-polybe",
    status: "mapped",
    op: "polybius",
    note: "主工具箱波利比奥斯",
  },
  {
    cat: "grid",
    name: "Chiffre des Nihilistes",
    slug: "chiffre-nihiliste",
    url: "https://www.dcode.fr/chiffre-nihiliste",
    status: "mapped",
    op: "nihilistCipher",
    note: "主工具箱虚无党",
  },
  {
    cat: "grid",
    name: "Chiffre à Deux Carrés",
    slug: "chiffre-deux-carres",
    url: "https://www.dcode.fr/chiffre-deux-carres",
    status: "mapped",
    op: "twosquare",
    note: "主工具箱双方",
  },
  {
    cat: "grid",
    name: "Chiffre à Trois Carrés",
    slug: "chiffre-trois-carres",
    url: "https://www.dcode.fr/chiffre-trois-carres",
    status: "mapped",
    op: "threeSquare",
    note: "主工具箱三方",
  },
  {
    cat: "grid",
    name: "Grille Tournante",
    slug: "chiffre-grille-tournante",
    url: "https://www.dcode.fr/chiffre-grille-tournante",
    status: "mapped",
    op: "turningGrille",
    note: "主工具箱转动格栅",
  },
  {
    cat: "grid",
    name: "Tap Code (Chiffre Frappé)",
    slug: "chiffre-frappe-tap",
    url: "https://www.dcode.fr/chiffre-frappe-tap",
    status: "mapped",
    op: "tapCode",
    note: "主工具箱敲击码",
  },
  {
    cat: "beliefs",
    name: "L'oeil d'Horus (Oudjat)",
    slug: "oeil-oudjat-horus",
    url: "https://www.dcode.fr/oeil-oudjat-horus",
    status: "blocked",
    reason: "dCode 页面仅提供位图/字体字形，缺少可核验的权威文本或 Unicode 映射；按任务规则不猜测。",
  },
  {
    cat: "beliefs",
    name: "Les 4 Elements",
    slug: "4-quatre-elements",
    url: "https://www.dcode.fr/4-quatre-elements",
    status: "implemented",
    op: "d1-four-elements",
  },
  {
    cat: "beliefs",
    name: "Numérologie Chaldéenne",
    slug: "numerologie-chaldeenne",
    url: "https://www.dcode.fr/numerologie-chaldeenne",
    status: "mapped",
    op: "dcode-extras-2026-10/math-wordvalue",
    note: "mode=chald",
  },
  {
    cat: "beliefs",
    name: "Numérologie Gematria",
    slug: "numerologie-gematria",
    url: "https://www.dcode.fr/numerologie-gematria",
    status: "mapped",
    op: "dcode-extras-2026-10/math-wordvalue",
    note: "mode=heb",
  },
  {
    cat: "beliefs",
    name: "Numérologie Isopséphie",
    slug: "numerologie-isopsephie",
    url: "https://www.dcode.fr/numerologie-isopsephie",
    status: "mapped",
    op: "dcode-extras-2026-10/math-wordvalue",
    note: "mode=greek",
  },
  {
    cat: "beliefs",
    name: "Numérologie de Pythagore",
    slug: "numerologie-pythagore",
    url: "https://www.dcode.fr/numerologie-pythagore",
    status: "mapped",
    op: "dcode-extras-2026-10/math-wordvalue",
    note: "mode=pyth",
  },
  {
    cat: "beliefs",
    name: "Signe Astrologique",
    slug: "signe-astrologique",
    url: "https://www.dcode.fr/signe-astrologique",
    status: "mapped",
    op: "astroSymbols",
    note: "set=zodiac",
  },
  {
    cat: "beliefs",
    name: "Signe Astrologique Chinois",
    slug: "signe-astrologique-chinois",
    url: "https://www.dcode.fr/signe-astrologique-chinois",
    status: "implemented",
    op: "d1-chinese-zodiac",
  },
  {
    cat: "beliefs",
    name: "Valeur d'un Mot",
    slug: "valeur-mot",
    url: "https://www.dcode.fr/valeur-mot",
    status: "mapped",
    op: "dcode-extras-2026-10/math-wordvalue",
    note: "mode=all",
  },
  {
    cat: "beliefs",
    name: "Versets de la Bible",
    slug: "bible-recherche-verset",
    url: "https://www.dcode.fr/bible-recherche-verset",
    status: "blocked",
    reason: "需要圣经全文数据库或联网检索。",
  },
  {
    cat: "history",
    name: "Chiffres Romains",
    slug: "chiffres-romains",
    url: "https://www.dcode.fr/chiffres-romains",
    status: "mapped",
    op: "roman",
    note: "主工具箱罗马数字",
  },
  {
    cat: "history",
    name: "Code Navajo",
    slug: "code-navajo",
    url: "https://www.dcode.fr/code-navajo",
    status: "blocked",
    reason: "依赖 dCode 未公开或需同版本外部码本（词表、页码、共版书籍），无法离线确定性复现。",
  },
  {
    cat: "history",
    name: "Futhark Récent ᚠᚢᚦᚬᚱᚴ",
    slug: "futhark-recent",
    url: "https://www.dcode.fr/futhark-recent",
    status: "mapped",
    op: "futhark",
    note: "variant=younger",
  },
  {
    cat: "history",
    name: "Numération Babylonienne",
    slug: "nombres-babyloniens",
    url: "https://www.dcode.fr/nombres-babyloniens",
    status: "mapped",
    op: "babylonianNumerals",
    note: "主工具箱巴比伦数字",
  },
  {
    cat: "history",
    name: "Numération Egyptienne",
    slug: "numeration-egyptienne",
    url: "https://www.dcode.fr/numeration-egyptienne",
    status: "mapped",
    op: "egyptianNumerals",
    note: "主工具箱埃及数字",
  },
  {
    cat: "history",
    name: "Numération Maya",
    slug: "nombres-mayas",
    url: "https://www.dcode.fr/nombres-mayas",
    status: "mapped",
    op: "mayaNumerals",
    note: "主工具箱玛雅数字",
  },
  {
    cat: "history",
    name: "Vieux Futhark ᚠᚢᚦᚨᚱᚲ",
    slug: "vieux-futhark",
    url: "https://www.dcode.fr/vieux-futhark",
    status: "mapped",
    op: "futhark",
    note: "variant=elder",
  },
  {
    cat: "homophonic",
    name: "Cadran Chiffrant de l'Armée Mexicaine",
    slug: "cadran-chiffrant-armee-mexicaine",
    url: "https://www.dcode.fr/cadran-chiffrant-armee-mexicaine",
    status: "implemented",
    op: "d1-cadran",
  },
  {
    cat: "homophonic",
    name: "Chiffre Homophonique",
    slug: "chiffre-homophonique",
    url: "https://www.dcode.fr/chiffre-homophonique",
    status: "mapped",
    op: "homophonic",
    note: "主工具箱同音替换",
  },
  {
    cat: "homophonic",
    name: "Chiffre de Arnold",
    slug: "chiffre-arnold",
    url: "https://www.dcode.fr/chiffre-arnold",
    status: "blocked",
    reason: "需要特定书籍同一版式（页码/行号），无法通用离线复现。",
  },
  {
    cat: "homophonic",
    name: "Chiffre de Grandpré",
    slug: "chiffre-grandpre",
    url: "https://www.dcode.fr/chiffre-grandpre",
    status: "implemented",
    op: "d1-grandpre",
  },
  {
    cat: "homophonic",
    name: "Chiffrement par Modulo",
    slug: "chiffre-modulo",
    url: "https://www.dcode.fr/chiffre-modulo",
    status: "implemented",
    op: "d1-modulo",
  },
  {
    cat: "homophonic",
    name: "Chiffre par Nomenclature",
    slug: "chiffre-nomenclature",
    url: "https://www.dcode.fr/chiffre-nomenclature",
    status: "implemented",
    op: "d1-nomenclature",
    note: "用户提供词表",
  },
];

export const COVERAGE_COUNTS = COVERAGE.reduce((acc, e) => {
  acc[e.status] += 1;
  return acc;
}, { implemented: 0, mapped: 0, blocked: 0 });
