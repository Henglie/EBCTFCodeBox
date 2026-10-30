import { runOp } from "../lib/util.js";

const NS = "dcode-extras-2026-10/";
const TEXT = NS + "cat-text";
const NUM = NS + "cat-numeral";
const MATH = NS + "cat-math";
const CIPHER = NS + "cat-cipher";

const P = (key, label, ph = "") => ({ key, label, type: "text", default: "", placeholder: ph });
const SEL = (key, label, def, opts) => ({ key, label, type: "select", default: def, options: opts.map((o) => (typeof o === "string" ? { value: o, label: o } : o)) });
const oid = (s) => NS + "e4-" + s;
const R = (id, cat, name, desc, params, fn) => runOp(oid(id), cat, name, desc, fn, params);
const E = (id, cat, name, desc, params, encode, decode) => ({ id: oid(id), cat, name, desc, params, encode, decode });

const enc = new TextEncoder();
const dec = new TextDecoder();
const bytesOf = (s) => enc.encode(String(s));
const catBytes = (parts) => {
  const n = parts.reduce((s, a) => s + a.length, 0);
  const out = new Uint8Array(n);
  let p = 0;
  for (const a of parts) { out.set(a, p); p += a.length; }
  return out;
};
const hexOf = (b) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

/* ================= Code 93 ================= */

const C93_BASIC = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-. $/+%";
const C93_SPECIAL = ["($)", "(%)", "(/)", "(+)"];
const C93_BITS = [
  "100010100", "101001000", "101000100", "101000010", "100101000", "100100100", "100100010", "101010000", "100010010", "100001010",
  "110101000", "110100100", "110100010", "110010100", "110010010", "110001010", "101101000", "101100100", "101100010", "100110100",
  "100011010", "101011000", "101001100", "101000110", "100101100", "100010110", "110110100", "110110010", "110101100", "110100110",
  "110010110", "110011010", "101101100", "101100110", "100110110", "100111010", "100101110", "111010100", "111010010", "111001010",
  "101101110", "101110110", "110101110", "100100110", "111011010", "111010110", "100110010", "101011110",
];
const C93_BASIC_VALUE = new Map([...C93_BASIC].map((c, i) => [c, i]));
const C93_SPECIAL_VALUE = new Map(C93_SPECIAL.map((s, i) => [s, 43 + i]));
const C93_BITS_VALUE = new Map(C93_BITS.map((b, i) => [b, i]));

function c93Pair(prefix, letter) {
  const pv = C93_SPECIAL_VALUE.get(prefix);
  const lv = C93_BASIC_VALUE.get(letter);
  if (pv === undefined || lv === undefined) throw new Error("Code93 扩展码表内部错误");
  return [pv, lv];
}

const C93_ASCII_ENC = (() => {
  const out = new Array(128).fill(null);
  for (const ch of C93_BASIC) out[ch.charCodeAt(0)] = [C93_BASIC_VALUE.get(ch)];
  for (let cp = 1; cp <= 26; cp++) out[cp] = c93Pair("($)", String.fromCharCode(64 + cp));
  for (let cp = 27; cp <= 31; cp++) out[cp] = c93Pair("(%)", String.fromCharCode(64 + cp - 26));
  out[0] = c93Pair("(%)", "U");
  for (let cp = 33; cp <= 44; cp++) out[cp] = c93Pair("(/)", String.fromCharCode(64 + cp - 32));
  out[58] = c93Pair("(/)", "Z");
  for (let cp = 59; cp <= 63; cp++) out[cp] = c93Pair("(%)", String.fromCharCode(64 + cp - 53));
  out[64] = c93Pair("(%)", "V");
  for (let cp = 91; cp <= 95; cp++) out[cp] = c93Pair("(%)", String.fromCharCode(64 + cp - 91 + 11));
  out[96] = c93Pair("(%)", "W");
  for (let cp = 97; cp <= 122; cp++) out[cp] = c93Pair("(+)", String.fromCharCode(64 + cp - 96));
  for (let cp = 123; cp <= 126; cp++) out[cp] = c93Pair("(%)", String.fromCharCode(64 + cp - 123 + 16));
  out[127] = c93Pair("(%)", "T");
  return out;
})();
const C93_ASCII_DEC = new Map();
for (let cp = 0; cp < 128; cp++) {
  const seq = C93_ASCII_ENC[cp];
  if (seq) C93_ASCII_DEC.set(seq.join(","), String.fromCharCode(cp));
}

function c93Label(v) {
  if (v < 43) return C93_BASIC[v];
  return C93_SPECIAL[v - 43];
}

function c93Check(values) {
  let sum = 0, w = 1;
  for (let i = values.length - 1; i >= 0; i--) {
    sum += values[i] * w;
    w = w === 20 ? 1 : w + 1;
  }
  return sum % 47;
}

function code93Encode(text) {
  const vals = [];
  for (const ch of String(text)) {
    const cp = ch.codePointAt(0);
    if (cp > 127) throw new Error(`Code93 只支持 ASCII 0-127，遇到「${ch}」`);
    vals.push(...C93_ASCII_ENC[cp]);
  }
  if (vals.length > 4000) throw new Error("Code93 数据过长（上限 4000 个符号）");
  const c = c93Check(vals);
  const k = c93Check(vals.concat(c));
  const all = [47, ...vals, c, k, 47];
  const bits = all.map((v) => C93_BITS[v]).join("") + "1";
  return `校验C: ${c93Label(c)}\n校验K: ${c93Label(k)}\n模块数: ${all.length * 9 + 1}\n模块串: ${bits}`;
}

function code93Decode(text) {
  let s = String(text).replace(/\s+/g, "");
  if (!/^[01]+$/.test(s)) throw new Error("Code93 解码需要 0/1 模块串");
  if (s.length % 9 === 1) s = s.slice(0, -1);
  if (s.length === 0 || s.length % 9 !== 0) throw new Error("Code93 模块串长度不是 9 的倍数");
  const vals = [];
  for (let i = 0; i < s.length; i += 9) {
    const b = s.slice(i, i + 9);
    const v = C93_BITS_VALUE.get(b);
    if (v === undefined) throw new Error(`位置 ${i} 的 9 位模块不是 Code93 码字`);
    vals.push(v);
  }
  if (vals.length < 4 || vals[0] !== 47 || vals[vals.length - 1] !== 47) throw new Error("Code93 缺少起止符 *");
  const body = vals.slice(1, -1);
  if (body.length < 2) throw new Error("Code93 缺少校验字符");
  const data = body.slice(0, -2);
  const c = body[body.length - 2], k = body[body.length - 1];
  if (c93Check(data) !== c) throw new Error("Code93 校验 C 不匹配");
  if (c93Check(data.concat(c)) !== k) throw new Error("Code93 校验 K 不匹配");
  let out = "";
  for (let i = 0; i < data.length;) {
    const v = data[i];
    if (v <= 42) { out += C93_BASIC[v]; i++; continue; }
    if (v >= 43 && v <= 46) {
      if (i + 1 >= data.length) throw new Error("Code93 扩展码前缀后缺少字母");
      const key = `${v},${data[i + 1]}`;
      const ch = C93_ASCII_DEC.get(key);
      if (ch === undefined) throw new Error(`Code93 扩展码无法识别（${c93Label(v)} + ${c93Label(data[i + 1])}）`);
      out += ch;
      i += 2;
      continue;
    }
    throw new Error("Code93 数据中出现起止符 *");
  }
  return out;
}

/* ================= Codabar ================= */

const CODABAR = {
  "0": "1111122", "1": "1111221", "2": "1112112", "3": "2211111", "4": "1121121",
  "5": "2111121", "6": "1211112", "7": "1211211", "8": "1221111", "9": "2112111",
  "-": "1112211", "$": "1122111", ":": "2111212", "/": "2121112", ".": "2121211",
  "+": "1122222", "A": "1122121", "B": "1212112", "C": "1112122", "D": "1112221",
};
const CODABAR_REV = new Map(Object.entries(CODABAR).map(([k, v]) => [v, k]));
const CODABAR_BODY = "0123456789-$:/.+";

function codabarBits(widths, wide = 3) {
  let out = "";
  for (let i = 0; i < widths.length; i++) {
    const bit = i % 2 === 0 ? "1" : "0";
    out += bit.repeat(widths[i] === "2" ? wide : 1);
  }
  return out;
}

function codabarEncode(text, p) {
  let s = String(text).toUpperCase().replace(/\s+/g, "");
  if (!s) throw new Error("Codabar 需要数据");
  const start = s[0] >= "A" && s[0] <= "D" ? s[0] : String((p && p.start) || "A").toUpperCase();
  const stop = s[s.length - 1] >= "A" && s[s.length - 1] <= "D" ? s[s.length - 1] : String((p && p.stop) || "B").toUpperCase();
  if (!"ABCD".includes(start) || !"ABCD".includes(stop)) throw new Error("Codabar 起止符只能是 A/B/C/D");
  let body = s;
  if (s[0] >= "A" && s[0] <= "D") body = body.slice(1);
  if (body.length && body[body.length - 1] >= "A" && body[body.length - 1] <= "D") body = body.slice(0, -1);
  for (const ch of body) if (!CODABAR_BODY.includes(ch)) throw new Error(`Codabar 不支持字符「${ch}」`);
  const widths = start + [...body].map((ch) => CODABAR[ch]).join("") + stop;
  let bits = "";
  for (const ch of [start, ...body, stop]) bits += codabarBits(CODABAR[ch]) + "0";
  return `起始: ${start}\n终止: ${stop}\n宽度串: ${widths}\n模块串: ${bits}`;
}

function codabarDecode(text) {
  const s = String(text).toUpperCase().replace(/\s+/g, "");
  if (!s) throw new Error("Codabar 解码需要宽度串");
  let i = 0;
  if (!"ABCD".includes(s[i])) throw new Error("Codabar 宽度串必须以 A/B/C/D 起止符开头");
  const start = s[i++];
  const body = [];
  let stop = "";
  while (i < s.length) {
    if ("ABCD".includes(s[i])) {
      stop = s[i++];
      if (i !== s.length) throw new Error("Codabar 终止符后还有数据");
      break;
    }
    const w = s.slice(i, i + 7);
    if (w.length !== 7 || !/^[12]+$/.test(w)) throw new Error(`Codabar 位置 ${i} 需要 7 位 1/2 宽度`);
    const ch = CODABAR_REV.get(w);
    if (ch === undefined) throw new Error(`Codabar 宽度模式「${w}」未定义`);
    if ("ABCD".includes(ch)) throw new Error("Codabar 起止符不能出现在数据中间");
    body.push(ch);
    i += 7;
  }
  if (!stop) throw new Error("Codabar 缺少终止符");
  return body.join("");
}

/* ================= French postal barcode ================= */

const POSTAL_FR = {
  "0": "..||||", "1": ".|.|||", "2": ".||.||", "3": ".|||.|", "4": "|..|||",
  "5": "|.|.||", "6": "|.||.|", "7": "||..||", "8": "||.|.|", "9": "|||..|",
};
const POSTAL_FR_REV = new Map(Object.entries(POSTAL_FR).map(([k, v]) => [v, k]));

function postalFrEncode(text) {
  const s = String(text).replace(/\s+/g, "");
  if (!/^\d{1,40}$/.test(s)) throw new Error("法国邮政条码只支持 1..40 位数字");
  const groups = [...s].reverse().map((d) => POSTAL_FR[d]);
  return groups.join(" ");
}

function postalFrDecode(text) {
  const s = String(text).replace(/\s+/g, "");
  if (!s || s.length % 6 !== 0) throw new Error("法国邮政条码每字符需 6 个符号");
  const groups = [];
  for (let i = 0; i < s.length; i += 6) {
    const g = s.slice(i, i + 6);
    if (!/^[.|]{6}$/.test(g) || [...g].filter((c) => c === "|").length !== 4) throw new Error(`位置 ${i} 的 6 符号组不是 4 竖线 + 2 点`);
    const d = POSTAL_FR_REV.get(g);
    if (d === undefined) throw new Error(`法国邮政条码组「${g}」未定义`);
    groups.push(d);
  }
  return groups.reverse().join("");
}

/* ================= Trevanion ================= */

function trevanionDecode(text, p) {
  const s = String(text);
  if (s.length > 200000) throw new Error("Trevanion 文本过长（上限 200000 字符）");
  const offset = Number((p && p.offset) || 1);
  if (!Number.isInteger(offset) || offset < 1 || offset > 100) throw new Error("Trevanion 偏移需为 1..100");
  const punct = String((p && p.punct) || ".,;!?");
  const out = [];
  let hits = 0;
  for (let i = 0; i < s.length; i++) {
    if (!punct.includes(s[i])) continue;
    hits++;
    let count = 0;
    for (let j = i + 1; j < s.length; j++) {
      if (punct.includes(s[j])) break;
      if (/\p{L}/u.test(s[j])) {
        count++;
        if (count === offset) { out.push(s[j].toUpperCase()); break; }
      }
    }
  }
  return `隐藏字母 (N=${offset}): ${out.join("") || "（无）"}\n命中标点: ${hits}`;
}

/* ================= Digrafid ================= */

const DGR_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ#";
const DGR_G3 = [[1, 2, 3], [4, 5, 6], [7, 8, 9]];
const DGR_P3 = new Map([[1, [0, 0]], [2, [0, 1]], [3, [0, 2]], [4, [1, 0]], [5, [1, 1]], [6, [1, 2]], [7, [2, 0]], [8, [2, 1]], [9, [2, 2]]]);

function dgrGrid(key, rows, cols) {
  const raw = String(key || DGR_ALPHABET).toUpperCase().replace(/[^A-Z#]/g, "") + DGR_ALPHABET;
  const uniq = [...new Set(raw.split(""))].slice(0, rows * cols);
  if (uniq.length !== rows * cols) throw new Error("Digrafid 网格字符不足");
  return Array.from({ length: rows }, (_, r) => uniq.slice(r * cols, (r + 1) * cols));
}
function dgrPos(grid) {
  const m = new Map();
  grid.forEach((row, r) => row.forEach((ch, c) => m.set(ch, [r, c])));
  return m;
}
function dgrBuild(p) {
  const g1 = dgrGrid((p && p.grid1Key) || DGR_ALPHABET, 3, 9);
  const g2 = dgrGrid((p && p.grid2Key) || DGR_ALPHABET, 9, 3);
  return { g1, g2, p1: dgrPos(g1), p2: dgrPos(g2) };
}
function dgrEncodeBlock(b, st) {
  const trips = [];
  for (let i = 0; i < 6; i += 2) {
    const [r1, c1] = st.p1.get(b[i]);
    const [r2, c2] = st.p2.get(b[i + 1]);
    trips.push([c1 + 1, DGR_G3[r1][c2], r2 + 1]);
  }
  const cols = [0, 1, 2].map((k) => trips.map((t) => t[k]));
  let out = "";
  for (const [x, y, z] of cols) {
    const [ly, cy] = DGR_P3.get(y);
    out += st.g1[ly][x - 1] + st.g2[z - 1][cy];
  }
  return out;
}
function dgrDecodeBlock(b, st) {
  const cols = [];
  for (let i = 0; i < 6; i += 2) {
    const [ly, x1] = st.p1.get(b[i]);
    const [z1, cy] = st.p2.get(b[i + 1]);
    cols.push([x1 + 1, DGR_G3[ly][cy], z1 + 1]);
  }
  const trips = [0, 1, 2].map((k) => cols.map((t) => t[k]));
  let out = "";
  for (const [x, y, z] of trips) {
    const [ly, cy] = DGR_P3.get(y);
    out += st.g1[ly][x - 1] + st.g2[z - 1][cy];
  }
  return out;
}
function digrafidEncode(text, p) {
  let s = String(text).toUpperCase().replace(/[^A-Z#]/g, "");
  if (!s) throw new Error("Digrafid 需要 A-Z 明文");
  while (s.length % 6) s += "#";
  const st = dgrBuild(p);
  let out = "";
  for (let i = 0; i < s.length; i += 6) out += dgrEncodeBlock(s.slice(i, i + 6), st);
  return out;
}
function digrafidDecode(text, p) {
  const s = String(text).toUpperCase().replace(/[^A-Z#]/g, "");
  if (!s || s.length % 6 !== 0) throw new Error("Digrafid 密文长度需为 6 的倍数");
  const st = dgrBuild(p);
  let out = "";
  for (let i = 0; i < s.length; i += 6) out += dgrDecodeBlock(s.slice(i, i + 6), st);
  return (p && p.strip === "non") ? out : out.replace(/#+$/, "");
}

/* ================= Charabia Latin ================= */

const CHARABIA_SUFFIXES = ["US", "UM", "AE", "IT", "IX", "OS", "AS", "IS", "EM", "AM", "AT", "ET"];

function charabiaEncode(text, p) {
  const suffix = String((p && p.suffix) || "US").toUpperCase();
  if (!/^[A-Z]{1,4}$/.test(suffix)) throw new Error("Charabia 后缀需为 1..4 个字母");
  return String(text).replace(/[\p{L}]+/gu, (w) => [...w].reverse().join("") + suffix);
}
function charabiaDecode(text) {
  return String(text).replace(/[\p{L}]+/gu, (w) => {
    const up = w.toUpperCase();
    for (const suf of CHARABIA_SUFFIXES) {
      if (up.endsWith(suf) && w.length > suf.length) return [...w.slice(0, -suf.length)].reverse().join("");
    }
    return [...w].reverse().join("");
  });
}

/* ================= Brainfuck family ================= */

const BF_COMMANDS = "+-<>[].,";
const BF_TAPE = 30000;
const BF_ALPHUCK = { "+": "e", "-": "i", ">": "a", "<": "c", "[": "p", "]": "s", ".": "j", ",": "o" };
const BF_ALPHUCK_REV = Object.fromEntries(Object.entries(BF_ALPHUCK).map(([k, v]) => [v, k]));
const BF_BINARY = { "+": "000", "-": "001", ">": "010", "<": "011", "[": "110", "]": "111", ".": "100", ",": "101" };
const BF_BINARY_REV = Object.fromEntries(Object.entries(BF_BINARY).map(([k, v]) => [v, k]));
const BF_PIKA = { "+": "pi", "-": "ka", ">": "pipi", "<": "pichu", "[": "pika", "]": "chu", ".": "pikachu", ",": "pikapi" };
const BF_PIKA_REV = Object.fromEntries(Object.entries(BF_PIKA).map(([k, v]) => [v, k]));
const BF_PIKA_RE = /pikachu|pikapi|pichu|pipi|pika|chu|pi|ka/g;
const BF_REVERSE = { "+": "-", "-": "+", ">": "<", "<": ">", "[": "]", "]": "[", ".": ",", ",": "." };

function bfExec(prog, input, maxSteps) {
  const src = String(prog);
  if (src.length > 2000000) throw new Error("Brainfuck 程序过长（上限 2M 字符）");
  const code = [...src].filter((c) => BF_COMMANDS.includes(c));
  const jump = new Int32Array(code.length).fill(-1);
  const stack = [];
  for (let i = 0; i < code.length; i++) {
    if (code[i] === "[") stack.push(i);
    else if (code[i] === "]") {
      if (!stack.length) throw new Error(`Brainfuck 位置 ${i} 的 ] 没有匹配的 [`); 
      const j = stack.pop();
      jump[i] = j; jump[j] = i;
    }
  }
  if (stack.length) throw new Error("Brainfuck 存在未闭合的 [");
  const tape = new Uint8Array(BF_TAPE);
  const inputBytes = bytesOf(input || "");
  const out = [];
  let ip = 0, ptr = 0, inp = 0, steps = 0;
  const limit = maxSteps || 5000000;
  while (ip < code.length) {
    if (++steps > limit) throw new Error(`Brainfuck 步数超过上限 ${limit}`);
    const op = code[ip];
    if (op === "+") tape[ptr] = (tape[ptr] + 1) & 255;
    else if (op === "-") tape[ptr] = (tape[ptr] - 1) & 255;
    else if (op === ">") { ptr++; if (ptr >= BF_TAPE) throw new Error("Brainfuck 指针越界"); }
    else if (op === "<") { ptr--; if (ptr < 0) throw new Error("Brainfuck 指针越界"); }
    else if (op === ".") { out.push(tape[ptr]); if (out.length > 1000000) throw new Error("Brainfuck 输出超过 1MB"); }
    else if (op === ",") tape[ptr] = inp < inputBytes.length ? inputBytes[inp++] : 0;
    else if (op === "[") { if (tape[ptr] === 0) ip = jump[ip]; }
    else if (op === "]") { if (tape[ptr] !== 0) ip = jump[ip]; }
    ip++;
  }
  return { out: Uint8Array.from(out), tape, steps };
}

function bfReport(result) {
  const text = [...result.out].map((b) => String.fromCharCode(b)).join("");
  const nz = [];
  for (let i = 0; i < result.tape.length && nz.length < 64; i++) if (result.tape[i]) nz.push(`${i}:${result.tape[i]}`);
  return `输出 (${result.out.length} 字节): ${text}\n十六进制: ${hexOf(result.out) || "（空）"}\n内存非零: ${nz.join(", ") || "无"}\n步数: ${result.steps}`;
}

function bfTranslate(prog, table) {
  const out = [];
  for (const ch of String(prog)) if (table[ch]) out.push(table[ch]);
  return out;
}
function alphuckProgram(prog) { return bfTranslate(prog, BF_ALPHUCK).join(""); }
function binaryfuckProgram(prog) { return bfTranslate(prog, BF_BINARY).join(""); }
function pikalangProgram(prog) { return bfTranslate(prog, BF_PIKA).join(" "); }
function reversefuckProgram(prog) { return bfTranslate(prog, BF_REVERSE).join(""); }
function alphuckToBf(text) { return [...String(text)].map((c) => BF_ALPHUCK_REV[c] || "").join(""); }
function binaryfuckToBf(text) {
  const s = String(text).replace(/[^01]/g, "");
  if (s.length % 3 !== 0) throw new Error("Binaryfuck 位数必须是 3 的倍数");
  let out = "";
  for (let i = 0; i < s.length; i += 3) {
    const op = BF_BINARY_REV[s.slice(i, i + 3)];
    if (!op) throw new Error(`Binaryfuck 三连位「${s.slice(i, i + 3)}」未定义`);
    out += op;
  }
  return out;
}
function pikalangToBf(text) { return String(text).replace(BF_PIKA_RE, (m) => BF_PIKA_REV[m]); }
function reversefuckToBf(text) { return [...String(text)].map((c) => BF_REVERSE[c] || "").join(""); }

/* ================= crypt(3) MD5 / SHA-256 ================= */

const CRYPT64 = "./0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const MD5_K = [
  0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee, 0xf57c0faf, 0x4787c62a, 0xa8304613, 0xfd469501,
  0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be, 0x6b901122, 0xfd987193, 0xa679438e, 0x49b40821,
  0xf61e2562, 0xc040b340, 0x265e5a51, 0xe9b6c7aa, 0xd62f105d, 0x02441453, 0xd8a1e681, 0xe7d3fbc8,
  0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed, 0xa9e3e905, 0xfcefa3f8, 0x676f02d9, 0x8d2a4c8a,
  0xfffa3942, 0x8771f681, 0x6d9d6122, 0xfde5380c, 0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70,
  0x289b7ec6, 0xeaa127fa, 0xd4ef3085, 0x04881d05, 0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665,
  0xf4292244, 0x432aff97, 0xab9423a7, 0xfc93a039, 0x655b59c3, 0x8f0ccc92, 0xffeff47d, 0x85845dd1,
  0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1, 0xf7537e82, 0xbd3af235, 0x2ad7d2bb, 0xeb86d391,
];
const MD5_S = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];
const rotl32 = (x, n) => ((x << n) | (x >>> (32 - n))) >>> 0;

function md5Bytes(bytes) {
  const len = bytes.length;
  const bit = BigInt(len) * 8n;
  const pad = ((56 - (len + 1) % 64) + 64) % 64;
  const buf = new Uint8Array(len + 1 + pad + 8);
  buf.set(bytes);
  buf[len] = 0x80;
  for (let i = 0; i < 8; i++) buf[buf.length - 8 + i] = Number((bit >> BigInt(8 * i)) & 255n);
  let a = 0x67452301, b = 0xefcdab89, c = 0x98badcfe, d = 0x10325476;
  for (let off = 0; off < buf.length; off += 64) {
    const M = new Array(16);
    for (let i = 0; i < 16; i++) M[i] = (buf[off + 4 * i] | (buf[off + 4 * i + 1] << 8) | (buf[off + 4 * i + 2] << 16) | (buf[off + 4 * i + 3] << 24)) >>> 0;
    let A = a, B = b, C = c, D = d;
    for (let i = 0; i < 64; i++) {
      let f, g;
      if (i < 16) { f = (B & C) | (~B & D); g = i; }
      else if (i < 32) { f = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
      else if (i < 48) { f = B ^ C ^ D; g = (3 * i + 5) % 16; }
      else { f = C ^ (B | ~D); g = (7 * i) % 16; }
      const tmp = D;
      D = C; C = B;
      B = (B + rotl32((A + f + MD5_K[i] + M[g]) >>> 0, MD5_S[i])) >>> 0;
      A = tmp;
    }
    a = (a + A) >>> 0; b = (b + B) >>> 0; c = (c + C) >>> 0; d = (d + D) >>> 0;
  }
  const out = new Uint8Array(16);
  [a, b, c, d].forEach((v, i) => {
    out[4 * i] = v & 255;
    out[4 * i + 1] = (v >>> 8) & 255;
    out[4 * i + 2] = (v >>> 16) & 255;
    out[4 * i + 3] = (v >>> 24) & 255;
  });
  return out;
}

const SHA256_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];
function sha256Bytes(bytes) {
  const len = bytes.length;
  const bit = BigInt(len) * 8n;
  const pad = ((56 - (len + 1) % 64) + 64) % 64;
  const buf = new Uint8Array(len + 1 + pad + 8);
  buf.set(bytes);
  buf[len] = 0x80;
  for (let i = 0; i < 8; i++) buf[buf.length - 1 - i] = Number((bit >> BigInt(8 * i)) & 255n);
  let H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const rr = (x, n) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < buf.length; off += 64) {
    const W = new Uint32Array(64);
    for (let i = 0; i < 16; i++) W[i] = (buf[off + 4 * i] << 24) | (buf[off + 4 * i + 1] << 16) | (buf[off + 4 * i + 2] << 8) | buf[off + 4 * i + 3];
    for (let i = 16; i < 64; i++) {
      const s0 = rr(W[i - 15], 7) ^ rr(W[i - 15], 18) ^ (W[i - 15] >>> 3);
      const s1 = rr(W[i - 2], 17) ^ rr(W[i - 2], 19) ^ (W[i - 2] >>> 10);
      W[i] = (W[i - 16] + s0 + W[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const S1 = rr(e, 6) ^ rr(e, 11) ^ rr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + SHA256_K[i] + W[i]) >>> 0;
      const S0 = rr(a, 2) ^ rr(a, 13) ^ rr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    H = [(H[0] + a) >>> 0, (H[1] + b) >>> 0, (H[2] + c) >>> 0, (H[3] + d) >>> 0, (H[4] + e) >>> 0, (H[5] + f) >>> 0, (H[6] + g) >>> 0, (H[7] + h) >>> 0];
  }
  const out = new Uint8Array(32);
  H.forEach((v, i) => {
    out[4 * i] = v >>> 24;
    out[4 * i + 1] = (v >>> 16) & 255;
    out[4 * i + 2] = (v >>> 8) & 255;
    out[4 * i + 3] = v & 255;
  });
  return out;
}
function cryptTo64(v, n) {
  let s = "";
  while (n-- > 0) { s += CRYPT64[v & 63]; v >>>= 6; }
  return s;
}
function md5crypt(pw, saltRaw) {
  const magic = "$1$";
  const salt = String(saltRaw).slice(0, 8);
  const pwB = bytesOf(pw), saltB = bytesOf(salt);
  const b = md5Bytes(catBytes([pwB, saltB, pwB]));
  const parts = [pwB, bytesOf(magic), saltB];
  for (let i = pwB.length; i > 0; i -= 16) parts.push(b.slice(0, Math.min(16, i)));
  for (let i = pwB.length; i > 0; i >>= 1) parts.push(i & 1 ? new Uint8Array([0]) : pwB.slice(0, 1));
  let final = md5Bytes(catBytes(parts));
  for (let i = 0; i < 1000; i++) {
    const c = [];
    c.push(i & 1 ? pwB : final);
    if (i % 3) c.push(saltB);
    if (i % 7) c.push(pwB);
    c.push(i & 1 ? final : pwB);
    final = md5Bytes(catBytes(c));
  }
  let out = magic + salt + "$";
  out += cryptTo64((final[0] << 16) | (final[6] << 8) | final[12], 4);
  out += cryptTo64((final[1] << 16) | (final[7] << 8) | final[13], 4);
  out += cryptTo64((final[2] << 16) | (final[8] << 8) | final[14], 4);
  out += cryptTo64((final[3] << 16) | (final[9] << 8) | final[15], 4);
  out += cryptTo64((final[4] << 16) | (final[10] << 8) | final[5], 4);
  out += cryptTo64(final[11], 2);
  return out;
}
function sha256crypt(pw, saltRaw, rounds = 5000) {
  const magic = "$5$";
  const salt = String(saltRaw).slice(0, 16);
  const pwB = bytesOf(pw), saltB = bytesOf(salt);
  const B = sha256Bytes(catBytes([pwB, saltB, pwB]));
  const aParts = [pwB, saltB];
  let remain = pwB.length;
  while (remain >= 32) { aParts.push(B); remain -= 32; }
  if (remain > 0) aParts.push(B.slice(0, remain));
  for (let i = pwB.length; i > 0; i >>= 1) aParts.push(i & 1 ? B : pwB);
  const A = sha256Bytes(catBytes(aParts));
  const DP = sha256Bytes(catBytes(Array.from({ length: pwB.length }, () => pwB)));
  const P = new Uint8Array(pwB.length);
  for (let i = 0; i < pwB.length; i += 32) P.set(DP.slice(0, Math.min(32, pwB.length - i)), i);
  const DS = sha256Bytes(catBytes(Array.from({ length: 16 + A[0] }, () => saltB)));
  const S = new Uint8Array(saltB.length);
  for (let i = 0; i < saltB.length; i += 32) S.set(DS.slice(0, Math.min(32, saltB.length - i)), i);
  let C = A;
  for (let i = 0; i < rounds; i++) {
    const parts = [];
    parts.push(i & 1 ? P : C);
    if (i % 3) parts.push(S);
    if (i % 7) parts.push(P);
    parts.push(i & 1 ? C : P);
    C = sha256Bytes(catBytes(parts));
  }
  const seq = [[0, 10, 20], [21, 1, 11], [12, 22, 2], [3, 13, 23], [24, 4, 14], [15, 25, 5], [6, 16, 26], [27, 7, 17], [18, 28, 8], [9, 19, 29]];
  let out = magic + (rounds === 5000 ? "" : `rounds=${rounds}$`) + salt + "$";
  for (const [x, y, z] of seq) out += cryptTo64((C[x] << 16) | (C[y] << 8) | C[z], 4);
  out += cryptTo64((C[31] << 8) | C[30], 3);
  return out;
}
function cryptRun(text, p) {
  const pw = String(text);
  if (pw.length > 1024) throw new Error("crypt 密码过长（上限 1024 字节）");
  let salt = String((p && p.salt) || "").trim();
  if (!salt) throw new Error("crypt 需要 salt（如 secret 或 $1$secret$）");
  if (salt.startsWith("$1$")) {
    salt = salt.slice(3).split("$")[0].slice(0, 8);
    return md5crypt(pw, salt);
  }
  if (salt.startsWith("$5$")) {
    const rest = salt.slice(3);
    let rounds = 5000;
    let raw = rest;
    if (rest.startsWith("rounds=")) {
      const m = rest.slice(7).match(/^(\d+)\$/);
      if (!m) throw new Error("crypt 的 rounds 格式应为 rounds=N$");
      rounds = Math.max(1000, Math.min(999999999, Number(m[1])));
      raw = rest.slice(7 + m[0].length);
    }
    const saltBody = raw.split("$")[0].slice(0, 16);
    return sha256crypt(pw, saltBody, rounds);
  }
  if (salt.startsWith("$2") || salt.startsWith("$6$") || /^[^$]{1,2}$/.test(salt)) {
    throw new Error("本 op 仅实现 $1$ MD5-crypt 与 $5$ SHA-256-crypt；bcrypt/SHA-512/DES 变体未实现");
  }
  const algo = String((p && p.algo) || "md5").toLowerCase();
  const body = salt.split("$")[0].slice(0, 16);
  if (algo === "sha256") return sha256crypt(pw, body);
  if (algo !== "md5") throw new Error("algo 只能是 md5 或 sha256");
  return md5crypt(pw, body.slice(0, 8));
}

/* ================= fixed-pair round robin ================= */

function pairsSchedule(text, p) {
  let items = String(text).split(/[\r\n,;]+/).map((s) => s.trim()).filter(Boolean);
  if (items.length < 2) throw new Error("至少需要 2 个队/人");
  if (items.length > 64) throw new Error("队伍数上限 64");
  if (!items.some((s) => s.includes("/"))) {
    if (items.length % 2) throw new Error("未使用 A/B 队名时人数必须为偶数");
    const teams = [];
    for (let i = 0; i < items.length; i += 2) teams.push(`${items[i]}/${items[i + 1]}`);
    items = teams;
  }
  if (items.length < 2) throw new Error("至少需要 2 个固定搭档队");
  const list = items.slice();
  const bye = list.length % 2 === 1;
  if (bye) list.push("BYE");
  const n = list.length;
  const rounds = [];
  for (let r = 0; r < n - 1; r++) {
    const pairs = [];
    for (let i = 0; i < n / 2; i++) {
      const a = list[i], b = list[n - 1 - i];
      if (a !== "BYE" && b !== "BYE") pairs.push(`${a} vs ${b}`);
    }
    rounds.push(`第 ${r + 1} 轮: ${pairs.join("；")}`);
    list.splice(1, 0, list.pop());
  }
  return `队伍 (${items.length}): ${items.join(", ")}${bye ? "（含轮空）" : ""}\n${rounds.join("\n")}`;
}

/* ================= Geek Code ================= */

const GEEK_CATS = [
  ["DI", "Dilbert", "呆伯特"], ["PE", "Politics & Economic", "政治经济"], ["PGP", "PGP", "PGP"],
  ["PS", "Politics & Social", "政治社会"], ["tv", "TV", "电视"], ["G", "Geek Code", "Geek 代码"],
  ["5", "Babylon 5", "巴比伦 5 号"], ["C", "Computers", "计算机"], ["D", "Doom", "毁灭战士"],
  ["E", "Emacs", "Emacs"], ["K", "Kibo", "Kibo"], ["L", "Linux", "Linux"], ["M", "Macintosh", "Macintosh"],
  ["N", "Usenet", "Usenet"], ["O", "OS/2", "OS/2"], ["P", "Perl", "Perl"], ["R", "Role-Playing", "角色扮演"],
  ["U", "UNIX", "UNIX"], ["V", "VMS", "VMS"], ["W", "World Wide Web", "万维网"], ["X", "X Files", "X 档案"],
  ["Y", "Cypherpunks", "密码朋克"], ["a", "Age", "年龄"], ["b", "Books", "书籍"], ["d", "Dress", "着装"],
  ["e", "Education", "教育"], ["h", "Housing", "住房"], ["o", "Usenet Oracle", "Usenet Oracle"],
  ["r", "Relationships", "感情"], ["s", "Shape", "体型"], ["t", "Star Trek", "星际迷航"],
  ["w", "Microsoft Windows", "Windows"], ["x", "Sex (Female)", "性别（女）"], ["y", "Sex (Male)", "性别（男）"],
  ["z", "Sex (Undisclosed)", "性别（保密）"],
].sort((a, b) => b[0].length - a[0].length || (a[0] < b[0] ? -1 : 1));
const GEEK_HEADERS = new Set(["GCS", "GIT", "GAT", "GSS", "GS", "GE", "GR"]);

function geekRating(rest) {
  const plus = (rest.match(/\+/g) || []).length;
  const minus = (rest.match(/-/g) || []).length;
  const digit = rest.match(/\d+/);
  const marks = [];
  for (const m of ["@", "$", "?", "*", "!"]) if (rest.includes(m)) marks.push(m);
  let base;
  if (digit) base = `数值 ${digit[0]}`;
  else if (plus) base = `+${plus}`;
  else if (minus) base = `-${minus}`;
  else base = "0";
  if (marks.length) base += ` [${marks.join(" ")}]`;
  return base;
}

function geekDecode(text) {
  const raw = String(text).replace(/-----BEGIN GEEK CODE BLOCK-----/g, " ").replace(/-----END GEEK CODE BLOCK-----/g, " ").replace(/^Version:\s*\S+/gim, " ");
  const tokens = raw.split(/\s+/).map((s) => s.trim()).filter(Boolean);
  if (!tokens.length) throw new Error("Geek Code 需要至少一个 token");
  const lines = [];
  let unknown = 0;
  for (const token of tokens) {
    if (GEEK_HEADERS.has(token)) { lines.push(`${token} → 标头/版本`); continue; }
    let hit = null;
    for (const [key, en, zh] of GEEK_CATS) {
      if (token.startsWith(key)) { hit = [key, en, zh]; break; }
    }
    if (!hit) { unknown++; lines.push(`${token} → 未识别`); continue; }
    const [key, en, zh] = hit;
    const rest = token.slice(key.length);
    lines.push(`${token} → ${zh} (${en}): ${geekRating(rest)}`);
  }
  if (lines.length === unknown) throw new Error("没有可识别的 Geek Code 类别");
  return `Geek Code token: ${tokens.length}，已识别: ${tokens.length - unknown}\n${lines.join("\n")}`;
}

/* ================= OPS ================= */

export const OPS = [
  E("code93", TEXT, "Code 93 条码（含 Full ASCII）", "Code93 9 模块码字、C/K 模 47 校验、Full ASCII 前缀扩展；输出 0/1 模块串，可反向解码并验证 C/K。表源 Wikipedia Code 93。",
    [P("text", "文本", "CODE93")], code93Encode, code93Decode),
  E("codabar", TEXT, "Codabar 条码", "Codabar 7 元素宽度码（1 窄 / 2 宽），支持 0-9 - $ : / . + 与 A-D 起止符；输出宽度串与模块串。",
    [P("text", "数据", "12345"), P("start", "起始符（未在文本中指定时）", "A"), P("stop", "终止符", "B")],
    (t, p) => codabarEncode(t, p), codabarDecode),
  E("postal-fr", TEXT, "法国邮政 4 态条码", "La Poste 邮编条码：每位数字 4 竖线 + 2 点，从右向左读取；输出分组符号串。",
    [P("text", "邮编/数字", "75001")], postalFrEncode, postalFrDecode),
  R("trevanion", CIPHER, "Trevanion 标点隐写提取", "按 dCode Trevanion 规则：每个标点后数 N 个字母取隐藏字符；N=3 的示例可还原 DCODE。仅提取，不在无载体时伪造编码。",
    [P("text", "带标点的载体文本", "Ce site , je d ois le dire , dé c hire !"), P("offset", "标点后第 N 个字母", "3"), P("punct", "触发标点集合", ".,;!?")],
    trevanionDecode),
  E("digrafid", CIPHER, "Digrafid 双格分数化密码", "3×9 与 9×3 双格 + 3×3 数字格；6 字母分块、三 triplet 行列转置。默认字母表 ABCDEFGHIJKLMNOPQRSTUVWXYZ#，DCODE ↔ MOLGAZ。",
    [P("text", "明文/密文", "DCODE"), P("grid1Key", "格 1 关键字（可空）", ""), P("grid2Key", "格 2 关键字（可空）", "")],
    (t, p) => digrafidEncode(t, p), (t, p) => digrafidDecode(t, p)),
  E("charabia", CIPHER, "Charabia Latin 拉丁黑话", "每个词倒序后加拉丁后缀（默认 -US）；解码剥离常见后缀再倒序。后缀为约定，存在固有歧义。",
    [P("text", "文本", "LATIN"), P("suffix", "编码后缀", "US")],
    (t, p) => charabiaEncode(t, p), (t) => charabiaDecode(t)),
  E("alphuck", CIPHER, "Alphuck 语言", "Brainfuck 的 8 字母替换：e=+ i=- a=> c=< p=[ s=] j=. o=,；encode 把 BF 程序转 Alphuck，decode 执行并输出。",
    [P("text", "Alphuck 程序或 BF 程序", "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeej"), P("input", "程序输入", ""), P("maxSteps", "最大步数", "5000000")],
    alphuckProgram, (t, p) => bfReport(bfExec(alphuckToBf(t), p && p.input, Number((p && p.maxSteps) || 5000000)))),
  E("binaryfuck", CIPHER, "Binaryfuck 语言", "Brainfuck 的 3 位二进制替换：+=000 -=001 >=010 <=011 [=110 ]=111 .=100 ,=101；decode 执行输出。",
    [P("text", "Binaryfuck 位串或 BF 程序", "000000000000000000000000000000110010"), P("input", "程序输入", ""), P("maxSteps", "最大步数", "5000000")],
    binaryfuckProgram, (t, p) => bfReport(bfExec(binaryfuckToBf(t), p && p.input, Number((p && p.maxSteps) || 5000000)))),
  E("pikalang", CIPHER, "Pikalang 语言", "Brainfuck 的 Pikachu 词替换：pi=+ ka=- pipi=> pichu=< pika=[ chu=] pikachu=. pikapi=,；decode 执行输出。",
    [P("text", "Pikalang 程序或 BF 程序", "pi pi pi pi pi pi pi pi pi pi pika pichu chu pikachu"), P("input", "程序输入", ""), P("maxSteps", "最大步数", "5000000")],
    pikalangProgram, (t, p) => bfReport(bfExec(pikalangToBf(t), p && p.input, Number((p && p.maxSteps) || 5000000)))),
  E("reversefuck", CIPHER, "ReverseFuck 语言", "Brainfuck 运算符取反：+↔- >↔< [↔] .↔,；encode 把 BF 程序转 ReverseFuck，decode 执行输出。",
    [P("text", "ReverseFuck 程序或 BF 程序", "-----------------------------------------------------------------,>+++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++"), P("input", "程序输入", ""), P("maxSteps", "最大步数", "5000000")],
    reversefuckProgram, (t, p) => bfReport(bfExec(reversefuckToBf(t), p && p.input, Number((p && p.maxSteps) || 5000000)))),
  R("crypt", CIPHER, "Unix crypt(3)：MD5 / SHA-256", "实现 $1$ MD5-crypt 与 $5$ SHA-256-crypt（含 rounds=N）。已知向量：dCode/secret 的 $1$ 与 $5$ 均与 dCode/OpenSSL 一致；$2$ bcrypt、$6$ SHA-512、2 字符 DES 变体明确报错。",
    [P("text", "密码", "dCode"), P("salt", "salt（secret 或 $1$secret$ / $5$secret$）", "secret"), SEL("algo", "algo（plain salt 时）", "md5", ["md5", "sha256"])],
    cryptRun),
  R("geek", TEXT, "Geek Code 结构化解码", "解析 Geek Code 块：最长前缀识别 DI/PE/PGP/PS/tv 等类别，统计 +/-/数值与 @/$/?/*/! 标记；输出结构化类别与等级，不逐字复刻 dCode 的长段落。",
    [P("text", "Geek Code 块", "GCS d-- s:+ a22 C+++ UB++ PGP t+ 5? tv+ b+ DI+ D+ e* h! r-- y?")],
    geekDecode),
  R("pairs", MATH, "固定搭档循环赛程", "把每个「A/B」队按圆桌法生成单循环赛程；奇数队轮空。用于 dCode Générateur de Championnat par Paires 的固定搭档赛程。",
    [P("text", "每行/逗号一个队伍，如 Alice/Bob", "A/B\nC/D\nE/F\nG/H")],
    pairsSchedule),
];

/* ================= COVERAGE ================= */

const ROWS = `cat-text\tCodage de Caractères\tCode Barres 93\tcode-barres-code-93
cat-text\tCodage de Caractères\tCode Barres Codabar\tcode-barres-codabar
cat-text\tCodage de Caractères\tCode Barres Postal Français\tcode-barres-postal-francais
cat-text\tInformatique (Autre/non classé)\tCréation de Fichier\tfichier-donnees
cat-text\tInformatique (Autre/non classé)\tKeysmash\tkeysmash-clavier
cat-text\tSystème de Notation\tLangue Ithkuil\tlangue-ithkuil
cat-text\tSystème de Notation\tMarquage Alpha Angle\tmarquage-alpha-angle
cat-text\tSystème de Notation\tNotation Laban\tnotation-laban
cat-text\tSystème de Notation\tNotation des Noeuds\tnotation-noeuds
cat-text\tTraitement d'Image\tCanaux CMJN\tcanaux-cmjn
cat-text\tTraitement d'Image\tCanaux TSL\tcanaux-tsl
cat-text\tTraitement d'Image\tCode Barres 93\tcode-barres-code-93
cat-text\tTraitement d'Image\tCode Barres Codabar\tcode-barres-codabar
cat-text\tTraitement d'Image\tCode Barres Postal Français\tcode-barres-postal-francais
cat-text\tTraitement d'Image\tDrapeaux du Monde\tdrapeaux
cat-text\tTraitement d'Image\tHistogramme d'une Image\thistogramme-image
cat-text\tTraitement d'Image\tImage CPBitmap\tformat-cpbitmap
cat-text\tTraitement d'Image\tImage de Pixels Aléatoires\timage-pixels-aleatoires
cat-text\tTraitement d'Image\tLecture de Pixels\tlecture-pixel-image
cat-text\tTraitement d'Image\tMiniature EXIF\tminiature-exif
cat-text\tTraitement d'Image\tOCR - Reconnaissance de Caractères\tocr-reconnaissance-de-caracteres-texte
cat-text\tdCode\tA Propos de dCode\ta-propos
cat-text\tdCode\tApplication Mobile dCode\tapplication-mobile
cat-text\tdCode\tListe des Outils dCode\tliste-outils
cat-text\tdCode\tdCode.fr\tfr
cat-text\tdCode\tListe de Tous les Outils\t#f0
cat-text\tdCode\tQu'est-ce qu'un outil sur dCode ? (Définition)\t#q1
cat-text\tdCode\tComment avoir la liste de tous les outils sur dCode ?\t#q2
cat-text\tdCode\tComment utiliser un outil sur dCode ?\t#q3
cat-text\tdCode\tComment proposer un nouvel outil ?\t#q4
cat-text\tdCode\tQuels sont les critères d'admissibilité d'un outil sur dCode ?\t#q5
cat-text\tdCode\tdCode.fr\tfr
cat-text\tdCode\tA Propos de dCode\ta-propos
cat-text\tdCode\tApplication Mobile dCode\tapplication-mobile
cat-text\tdCode\tChiffrements du Moyen-Age\tchiffrements-moyen-age
cat-text\tdCode\tChiffrements Multi-Couches\tchiffrements-multi-couches
cat-text\tdCode\tSolveur Wordament\tsolveur-wordament
cat-text\tdCode\tLISTE DES OUTILS DCODE\tliste-outils
cat-text\tdCode\tPaypal\twebscr?cmd=_s-xclick&hosted_button_id=S53H3S52HJH6N&source=url
cat-text\tdCode\tCrypto-monnaies\tjavascript:;
cat-text\tdCode\tDiscord\tAT9V5Vq
cat-text\tdCode\tContact\ta-propos
cat-text\tdCode\tA propos\ta-propos
cat-text\tdCode\tApplication\tapplication-mobile
cat-text\tdCode\tPrise2Tete\t
cat-text\tdCode\tWikipedia\t
cat-math\tCompression\tGénérateur de Championnat par Paires\tgenerateur-championnat-paires
cat-text\tSystème de Communication (Autre/non classé)\tAccent Allemand\taccent-allemand
cat-text\tSystème de Communication (Autre/non classé)\tAccent Anglais\taccent-anglais
cat-text\tSystème de Communication (Autre/non classé)\tAccent Asiatique\taccent-asiatique
cat-text\tSystème de Communication (Autre/non classé)\tAccent Espagnol\taccent-hispanique
cat-text\tSystème de Communication (Autre/non classé)\tAccent Etranger\taccent-etranger
cat-text\tSystème de Communication (Autre/non classé)\tAccent Français\taccent-francais
cat-text\tSystème de Communication (Autre/non classé)\tAccent Italien\taccent-italien
cat-text\tSystème de Communication (Autre/non classé)\tAccent Russe\taccent-russe
cat-text\tSystème de Communication (Autre/non classé)\tCode Chappe\tcode-chappe
cat-text\tSystème de Communication (Autre/non classé)\tEcriture Dotsies\tecriture-dotsies
cat-text\tSystème de Communication (Autre/non classé)\tLangage Iokharique\tlangage-iokharique
cat-text\tSystème de Communication (Autre/non classé)\tLangue des Signes Américaine\tlangue-des-signes-americaine
cat-text\tSystème de Communication (Autre/non classé)\tLangue des Signes Française\tlangue-des-signes-francaise
cat-text\tStéganographie\tCharabia Latin\tcharabia-latin
cat-text\tStéganographie\tChiffre Friderici (Fenêtres)\tchiffre-friderici-fenetres
cat-text\tStéganographie\tChiffrement par Dissimulation\tchiffrement-dissimulation
cat-text\tStéganographie\tCode Trevanion\tchiffre-trevanion
cat-text\tStéganographie\tFormes de Caractères Binaires\tbinaire-forme-caractere
cat-text\tStéganographie\tTraits des Lettres\tchiffre-traits-lettre
cat-cipher\tChiffrement par Transposition\tChiffre Swagman\tchiffre-swagman
cat-cipher\tChiffrement par Transposition\tKryptos\tsculpture-kryptos
cat-text\tLangage de Programmation\tAlphuck\tlangage-alphuck
cat-text\tLangage de Programmation\tBinaryfuck\tlangage-binaryfuck
cat-text\tLangage de Programmation\tDésobfuscateur Javascript\tdesobfuscateur-javascript
cat-text\tLangage de Programmation\tLangage Hodor\tlangage-hodor
cat-text\tLangage de Programmation\tPikalang\tlangage-pikalang
cat-text\tLangage de Programmation\tReverseFuck\tlangage-reversefuck
cat-text\tLangage de Programmation\tShakespeare (Langage de Programmation)\tshakespeare-langage-programmation
cat-cipher\tCryptographie Moderne\tHachage avec Crypt()\tfonction-hachage-crypt
cat-numeral\tSystème de Numération\tNumération D'ni\tnumeration-dni
cat-cipher\tChiffrement Polygrammique\tChiffre Digrafide\tchiffre-digrafide
cat-cipher\tChiffrement Polygrammique\tTraits des Lettres\tchiffre-traits-lettre
cat-text\tDonnées Brutes\tChiffre McCormick\tchiffre-mccormick
cat-text\tDonnées Brutes\tEchelle de Monoyer\techelle-monoyer
cat-text\tDonnées Brutes\tEchelle de Snellen\techelle-snellen
cat-text\tDonnées Brutes\tHTML\tediteur-html
cat-text\tDonnées Brutes\tJavascript\tediteur-javascript
cat-text\tDonnées Brutes\tLes 4 Elements\t4-quatre-elements
cat-cipher\tCryptographie (Autre/non classé)\tChiffre McCormick\tchiffre-mccormick
cat-cipher\tCryptographie (Autre/non classé)\tChiffrements Multi-Couches\tchiffrements-multi-couches
cat-cipher\tCryptographie (Autre/non classé)\tChiffrements du Moyen-Age\tchiffrements-moyen-age
cat-text\tGeek\tCode Geek\tcode-geek
cat-text\tGeek\tEcriture LSPK90 Horaire\tlspk90-h-leet-speak-90-degres-horaire`;

const E4_IMPL = {
  "code-barres-code-93": "code93",
  "code-barres-codabar": "codabar",
  "code-barres-postal-francais": "postal-fr",
  "chiffre-trevanion": "trevanion",
  "chiffre-digrafide": "digrafid",
  "charabia-latin": "charabia",
  "langage-alphuck": "alphuck",
  "langage-binaryfuck": "binaryfuck",
  "langage-pikalang": "pikalang",
  "langage-reversefuck": "reversefuck",
  "fonction-hachage-crypt": "crypt",
  "generateur-championnat-paires": "pairs",
  "code-geek": "geek",
};
const E4_MAP = {
  "keysmash-clavier": NS + "txt-keysmash",
  "solveur-wordament": NS + "d3-boggle",
  "chiffre-swagman": NS + "d1-swagman",
  "4-quatre-elements": NS + "d1-four-elements",
  "miniature-exif": "imageThumb",
};
const BLOCK_GROUPS = {
  "dCode 站点导航/FAQ/外链页，非算法工具": ["a-propos", "application-mobile", "liste-outils", "fr", "#f0", "#q1", "#q2", "#q3", "#q4", "#q5", "webscr?cmd=_s-xclick&hosted_button_id=S53H3S52HJH6N&source=url", "javascript:;", "AT9V5Vq", ""],
  "dCode 专题/多算法综述页，无单一可逆算法": ["chiffrements-moyen-age", "chiffrements-multi-couches", "chiffrement-dissimulation"],
  "需要栅格图像/像素/OCR/图像数据集，纯文本 op 无法诚实承载": ["canaux-cmjn", "canaux-tsl", "drapeaux", "histogramme-image", "format-cpbitmap", "image-pixels-aleatoires", "lecture-pixel-image", "ocr-reconnaissance-de-caracteres-texte"],
  "语言口音/发音参考页，无确定性编解码": ["accent-allemand", "accent-anglais", "accent-asiatique", "accent-hispanique", "accent-etranger", "accent-francais", "accent-italien", "accent-russe"],
  "构造语言/虚构文字/手语，需词典或图像视频": ["langue-ithkuil", "langage-iokharique", "langue-des-signes-americaine", "langue-des-signes-francaise"],
  "字形仅以图片给出，缺少可核实文本/Unicode 映射": ["ecriture-dotsies", "numeration-dni", "marquage-alpha-angle", "code-chappe", "chiffre-friderici-fenetres", "lspk90-h-leet-speak-90-degres-horaire"],
  "需要图形/多项式/图形记谱，非文本算法": ["notation-laban", "notation-noeuds"],
  "按字符形状/笔画数编码，无唯一确定性映射": ["binaire-forme-caractere", "chiffre-traits-lettre"],
  "需要执行 JavaScript（安全边界外）": ["desobfuscateur-javascript", "langage-hodor"],
  "完整解释器/语言运行时未实现": ["shakespeare-langage-programmation"],
  "视力表为图像/字体，非算法": ["echelle-monoyer", "echelle-snellen"],
  "HTML/JavaScript 编辑器 UI，非算法": ["editeur-html", "editeur-javascript"],
  "dCode 明言该密码未解决，仅提供手稿转录，无解码算法": ["chiffre-mccormick"],
  "Kryptos 为特定雕塑，K4 密钥/分段未完整公开": ["sculpture-kryptos"],
  "dCode 文件创建/下载 UI，文本 op 不能生成可下载文件": ["fichier-donnees"],
};
const E4_BLOCK = {};
for (const [reason, slugs] of Object.entries(BLOCK_GROUPS)) for (const s of slugs) E4_BLOCK[s] = reason;

export const COVERAGE = ROWS.split("\n").map((line) => {
  const [cat, sourceCat, name, slug] = line.replace(/\r$/, "").split("\t");
  if (!cat || !sourceCat || !name || slug === undefined) throw new Error("E4 覆盖行格式错误: " + line);
  const entry = { cat: NS + cat, sourceCat, name, slug };
  if (E4_IMPL[slug]) return { ...entry, status: "implemented", op: oid(E4_IMPL[slug]) };
  if (E4_MAP[slug]) return { ...entry, status: "mapped", target: E4_MAP[slug] };
  if (E4_BLOCK[slug]) return { ...entry, status: "blocked", reason: E4_BLOCK[slug] };
  throw new Error("E4 覆盖台账缺少状态: " + slug);
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
  return {
    entries: COVERAGE.length,
    byStatus,
    byCat,
    unique: { implemented: uniq.implemented.size, mapped: uniq.mapped.size, blocked: uniq.blocked.size },
  };
})();
