/*
 * vic.js — VIC 密码（cat:'classic'）。
 *
 * 原理（照权威来源，未编造）：
 *  - 冷战期苏联间谍 Häyhänen 用的铅笔密码，Nihilist 族顶点。流程：
 *    (1) 由「口令短语(≥20字母) + 日期(6位数字) + 个人号(1-2位) + 5位密钥组」派生一串伪随机数字：
 *        A=密钥组；B=日期前5位；C=A−B 逐位 mod10；D=短语前20字母；E=D 前后两半各自「排序编号」
 *        （字母序最小=1……并列取先出现，0 表示 10）；F=C 链式相加扩到 10 位；G=E1+F 逐位 mod10；
 *        H=用 E2 作密钥把 G 「数字编码」；J=H 的排序编号；K..P=从 H 链式相加出的 50 位（不含种子 H）。
 *    (2) P 行末尾两个互不相同的数字各加个人号 → 两个换位宽度 a、b；50 位块按 J 的列序读出，
 *        前 a 位 = 第一换位密钥 Q，接下 b 位 = 第二换位密钥 R；Line-P 的排序编号 = S。
 *    (3) 跨行棋盘（straddling checkerboard）：表头 10 列 = S 的 10 个数字，第 3、7 列顶行留空，
 *        其 数字 成为两个跨行行标；8 个高频字母（记忆口诀，默认 AT ONE SIR）填其余 8 列顶行；
 *        剩余字母按序 + '.' + '/' 填两行跨行行。数字报文：'/' 开shift，每位数字连发三遍，'/' 关shift。
 *    (4) 明文先棋盘化成数字，再过两次换位：Q 作标准列换位；R 作「三角扰乱」列换位
 *        （读出按密钥列序；填入时两个三角区最后填：T1 起于排名第 1 的列顶端向右到行尾，
 *        逐行起点右移一列直到只剩最右列；空一行后 T2 起于排名第 2 的列，同样逐行右移）。
 *    (5) 报文可先「对半倒置」：在任意处切开，后半 + '/' 标记 + 前半，抗已知格式攻击。
 *
 * 权威来源：
 *  - Wikipedia「VIC cipher」(https://en.wikipedia.org/wiki/VIC_cipher)，访问日期 2026-09-22：
 *    完整密钥派生例（personal 6 / date 139195 / phrase 'Twas the night before Christmas /
 *    keygroup 72401 → Line-A..S 全部给出），及棋盘阶段输出
 *    「mean 0500. Not 0915 like you did last time./Attack at dawn. By dawn I」
 *    → 6025380000555000000808731980000999111555806776428818666766675499760287599569645966583387658866588337。
 *  - J. Savard「The VIC Cipher」(http://www.quadibloc.com/crypto/pp1324.htm)，访问日期 2026-09-22：
 *    完整端到端算例（date 741776 / indicator 77651 / 'I dream of Jeannie with t' / personal 8），
 *    含 50 位块列读出 3653469323392894735236270398134、第一换位中间密文、三角扰乱第二换位最终密文
 *    3617805428995925350701440001134200474684584267504842503100846918177284836034750350076684838824242838909
 *    60350713758689914050008042900873786014472544860（150 位，含 1 位补位 null）。
 *
 * 约定（工程化说明，非杜撰算法）：
 *  - 输入只保留 A-Z（大写化）、0-9、'.'、'/'；空格丢弃；其他字符报错。
 *    '/' 为保留字（数字 shift 与对半标记），用户文本含 '/' 直接报错。
 *  - 传输层两约定未纳入默认输出：补 null 至 5 的倍数、密钥组按日期第 6 位插组——它们不属于
 *    密码本体且使严格往返不可能；两来源算例中这些步骤在对拍中以内部函数逐层核验。
 *  - 换位密钥列序沿用 VIC「排序编号」口径（0 视为 10 最大，并列取先出现）。
 *  - cut>0 时按该字符数切开原文做对半倒置（后半 + '/' + 前半）；解码见标记自动复原。
 *
 * 契约：register({id, cat:"classic", name, desc, params, encode, decode})。
 */
import { register } from "./registry.js";

const AZ = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const AIDE = "1234567890"; // 数字编码对照行（F.2）

function digitsOnly(s, what) {
  const d = [...String(s == null ? "" : s)].filter((c) => c >= "0" && c <= "9").join("");
  if (!/^\d+$/.test(String(s == null ? "" : s).trim()))
    throw new Error(`VIC：${what}必须是纯数字串（拿到 "${s}"）。`);
  return d;
}

/** 排序编号（0 视为 10；并列取先出现）。输入 10 位数字或 10 个字母。 */
function sequence(units, letters) {
  const rankOf = new Array(units.length).fill(0);
  const idx = units.map((u, i) => [u, i]);
  idx.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] - b[1]));
  idx.forEach(([, orig], zeroBased) => { rankOf[orig] = (zeroBased + 1) % 10; });
  return rankOf.join("");
}

function seqDigits(s10) {
  return sequence([...s10].map((c) => (c === "0" ? 10 : Number(c))));
}

function seqLetters(s10) {
  return sequence([...String(s10).toUpperCase()]);
}

/** 逐位 mod10 减/加。 */
function subMod10(a, b) {
  let out = "";
  for (let i = 0; i < a.length; i++) out += String((Number(a[i]) - Number(b[i]) + 10) % 10);
  return out;
}
function addMod10(a, b) {
  let out = "";
  for (let i = 0; i < a.length; i++) out += String((Number(a[i]) + Number(b[i])) % 10);
  return out;
}

/** 链式相加（lagged Fibonacci）：第 k 个新位 = 已生成序列中第 k、k+1 位之和的个位。 */
function chainAdd(seed, total) {
  const d = [...seed].map(Number);
  let i = 0;
  while (d.length < total) {
    d.push((d[i] + d[i + 1]) % 10);
    i++;
  }
  return d.join("");
}

/** 数字编码：用 key（E.2）+ 辅助行 1234567890 把 G 逐位替换。 */
function digitEncode(g, e2) {
  const map = {};
  for (let i = 0; i < 10; i++) map[AIDE[i]] = e2[i];
  return [...g].map((c) => map[c]).join("");
}

/** 密钥派生：返回所有中间线与 Q/R/S。 */
function deriveVicKeys(phrase, date, personal, keygroup) {
  const A = digitsOnly(keygroup, "密钥组");
  if (A.length !== 5) throw new Error(`VIC：密钥组必须 5 位数字（拿到 ${A.length} 位）。`);
  const dateD = digitsOnly(date, "日期");
  if (dateD.length < 6) throw new Error(`VIC：日期至少 6 位数字（拿到 ${dateD.length} 位）。`);
  const B = dateD.slice(0, 5);
  const pn = Number(personal);
  if (!Number.isInteger(pn) || pn < 1 || pn > 99) throw new Error(`VIC：个人号须为 1-99 的整数。`);
  const C = subMod10(A, B);
  const letters = [...String(phrase == null ? "" : phrase).toUpperCase()].filter((c) => AZ.includes(c));
  if (letters.length < 20) throw new Error(`VIC：口令短语至少 20 个字母（拿到 ${letters.length} 个）。`);
  const D = letters.slice(0, 20).join("");
  const E1 = seqLetters(D.slice(0, 10));
  const E2 = seqLetters(D.slice(10));
  const F1 = chainAdd(C, 10);
  const G = addMod10(E1, F1);
  const H = digitEncode(G, E2);
  const J = seqDigits(H);
  const chain = chainAdd(H, 60);
  const block = chain.slice(10); // K..P 共 50 位（不含种子 H）
  const P = block.slice(40);
  // 末尾两个互不相同的数字（第二个先取最后一个，往前找第一个与之不同的）
  const last = P[9];
  let k = 8;
  while (k >= 0 && P[k] === last) k--;
  if (k < 0) throw new Error("VIC：Line-P 末 10 位全相同，无法定换位宽度（极罕见）。");
  const a = pn + Number(P[k]);
  const b = pn + Number(last);
  // 50 位块按 J 列序读出
  const colOrder = [];
  [...J].map((c, i) => [c === "0" ? 10 : Number(c), i])
    .sort((x, y) => (x[0] - y[0]) || (x[1] - y[1]))
    .forEach(([, i]) => colOrder.push(i));
  let stream = "";
  for (const c of colOrder) for (let r = 0; r < 5; r++) stream += block[r * 10 + c];
  if (a + b > stream.length) throw new Error(`VIC：50 位块不足以取 ${a}+${b} 位换位密钥。`);
  const Q = stream.slice(0, a);
  const R = stream.slice(a, a + b);
  const S = seqDigits(P);
  return { A, B, C, D, E1, E2, F1, G, H, J, K: block.slice(0, 10), L: block.slice(10, 20), M: block.slice(20, 30), N: block.slice(30, 40), P, block, Q, R, S, widths: [a, b] };
}

/** 构造跨行棋盘：S + 记忆口诀。返回 { codeOf:Map, cellOf:Map }。 */
function buildCheckerboard(S, mnemonic) {
  const mn = [...String(mnemonic == null ? "" : mnemonic).toUpperCase()].filter((c) => AZ.includes(c));
  if (mn.length !== 8 || new Set(mn).size !== 8)
    throw new Error(`VIC：记忆口诀须为 8 个互不相同的字母（拿到 "${mnemonic}"）。`);
  const straddle1 = S[2], straddle2 = S[6];
  if (straddle1 === straddle2) throw new Error("VIC：S 第 3、7 位相同，无法构造跨行棋盘。");
  const used = new Set(mn);
  const rest = [...AZ].filter((c) => !used.has(c));
  const cells20 = [...rest, ".", "/"];
  if (cells20.length !== 20) throw new Error("VIC：棋盘剩余格构造异常。");
  const rowA = cells20.slice(0, 10);
  const rowB = cells20.slice(10);
  const codeOf = new Map();
  const cellOf = new Map();
  let m = 0;
  for (let j = 0; j < 10; j++) {
    if (j === 2 || j === 6) continue;
    const ch = mn[m++];
    codeOf.set(ch, S[j]);
    cellOf.set(S[j], ch);
  }
  for (let j = 0; j < 10; j++) {
    const code1 = straddle1 + S[j];
    codeOf.set(rowA[j], code1);
    cellOf.set(code1, rowA[j]);
    const code2 = straddle2 + S[j];
    codeOf.set(rowB[j], code2);
    cellOf.set(code2, rowB[j]);
  }
  return { codeOf, cellOf, rowA, rowB, straddle1, straddle2 };
}

/** 棋盘编码：字母→码；数字段 '/' + 每位三遍 + '/'；空格丢弃；'/' 输入报错。 */
function vicCheckerboardEncode(text, S, mnemonic) {
  const { codeOf } = buildCheckerboard(S, mnemonic);
  const src = String(text == null ? "" : text);
  let out = "";
  let i = 0;
  const norm = [...src.toUpperCase()];
  while (i < norm.length) {
    const ch = norm[i];
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") { i++; continue; }
    if (ch >= "0" && ch <= "9") {
      let run = "";
      while (i < norm.length && norm[i] >= "0" && norm[i] <= "9") { run += norm[i]; i++; }
      out += codeOf.get("/") + [...run].map((d) => d + d + d).join("") + codeOf.get("/");
      continue;
    }
    if (!codeOf.has(ch))
      throw new Error(`VIC：输入含棋盘外字符 "${ch}"（只支持 A-Z、0-9、'.'、'/'，空格自动丢弃）。`);
    out += codeOf.get(ch);
    i++;
  }
  if (!out) throw new Error("VIC：输入不含任何可用字符。");
  return out;
}

/** 棋盘解码：'/' 后按三遍一数字直到闭合 '/'；对半标记 '/'（后不接三遍段）按字面输出。 */
function vicCheckerboardDecode(digits, S, mnemonic) {
  const { cellOf, codeOf } = buildCheckerboard(S, mnemonic);
  const slash = codeOf.get("/");
  let out = "";
  let i = 0;
  while (i < digits.length) {
    const one = digits[i];
    const cell = cellOf.get(one);
    if (cell != null) { // 顶行高频字母（单数字码）
      out += cell;
      i++;
      continue;
    }
    const two = digits.slice(i, i + 2);
    const cell2 = cellOf.get(two);
    if (cell2 == null) throw new Error(`VIC：密文在位置 ${i} 出现无效码 "${two}"。`);
    if (cell2 === "/") {
      let j = i + 2;
      let run = "";
      let ok = false;
      if (!(digits[j] === slash[0] && digits[j + 1] === slash[1])) {
        while (digits[j] && digits[j + 1] && digits[j + 2] &&
               digits[j] === digits[j + 1] && digits[j + 1] === digits[j + 2]) {
          run += digits[j];
          j += 3;
          if (digits[j] === slash[0] && digits[j + 1] === slash[1]) { ok = true; break; }
        }
      }
      if (ok) { out += run; i = j + 2; continue; }
      out += "/";
      i += 2;
      continue;
    }
    out += cell2;
    i += 2;
  }
  return out;
}

/** 排名列序（0 视为 10，并列先出现）。 */
function keyColumns(key) {
  return [...key].map((c, i) => [c === "0" ? 10 : Number(c), i])
    .sort((x, y) => (x[0] - y[0]) || (x[1] - y[1]))
    .map(([, i]) => i);
}

/** 标准列换位（最后行可能不完整）。 */
function columnarTranspose(digits, key, decode) {
  const order = keyColumns(key);
  const W = key.length;
  const n = digits.length;
  const rows = Math.ceil(n / W);
  const lastLen = ((n - 1) % W) + 1;
  if (!decode) {
    const grid = Array.from({ length: rows }, () => new Array(W).fill(""));
    let p = 0;
    for (let r = 0; r < rows; r++) for (let c = 0; c < W; c++) { if (p < n) grid[r][c] = digits[p++]; }
    let out = "";
    for (const c of order) for (let r = 0; r < rows; r++) if (grid[r][c]) out += grid[r][c];
    return out;
  }
  const colLen = (c) => (c < lastLen ? rows : rows - 1);
  const grid = Array.from({ length: rows }, () => new Array(W).fill(""));
  let p = 0;
  for (const c of order) for (let r = 0; r < colLen(c); r++) grid[r][c] = digits[p++];
  let out = "";
  for (let r = 0; r < rows; r++) for (let c = 0; c < W; c++) if (grid[r][c]) out += grid[r][c];
  return out;
}

/**
 * 三角扰乱列换位（Savard 口径）：
 * 填表时先跳过三角区（行优先填普通格），再行优先补三角格；读出按密钥列序逐列自上而下。
 * T1：起于排名第 1 的列顶端、向右到行尾，逐行起点右移一列，直到只剩最右列；
 * 空一行后 T2 起于排名第 2 的列，同样逐行右移（超出网格自然截断）。
 */
function diagonalTranspose(digits, key, decode) {
  const order = keyColumns(key);
  const W = key.length;
  const n = digits.length;
  const rows = Math.ceil(n / W);
  const cellLen = (r) => (r === rows - 1 ? n - (rows - 1) * W : W);
  const t1Col = order[0], t2Col = order[1];
  const inT1 = (r, c) => c >= t1Col + r && r < W - t1Col;
  const t2Start = (W - t1Col) + 1;
  const inT2 = (r, c) => r >= t2Start && c >= t2Col + (r - t2Start);
  const isTri = (r, c) => inT1(r, c) || inT2(r, c);
  const all = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cellLen(r); c++) all.push([r, c]);
  const normal = all.filter(([r, c]) => !isTri(r, c));
  const tri = all.filter(([r, c]) => isTri(r, c));
  if (!decode) {
    const grid = Array.from({ length: rows }, () => new Array(W).fill(""));
    const fill = [...normal, ...tri];
    fill.forEach(([r, c], idx) => { grid[r][c] = digits[idx]; });
    let out = "";
    for (const c of order) for (let r = 0; r < rows; r++) if (grid[r][c]) out += grid[r][c];
    return out;
  }
  const grid = Array.from({ length: rows }, () => new Array(W).fill(""));
  const readSeq = [];
  for (const c of order) for (let r = 0; r < rows; r++) if (grid[r][c] !== undefined && r < rows && c < cellLen(r)) readSeq.push([r, c]);
  readSeq.forEach(([r, c], idx) => { grid[r][c] = digits[idx]; });
  let out = "";
  for (const [r, c] of [...normal, ...tri]) out += grid[r][c];
  return out;
}

/** 归一化：只留 A-Z/0-9/./，空格丢弃，其他报错（'/' 保留给标记，用户输入 '/' 报错）。 */
function vicNorm(text, allowSlash) {
  const src = String(text == null ? "" : text).toUpperCase();
  let out = "";
  for (const ch of src) {
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") continue;
    if (AZ.includes(ch) || (ch >= "0" && ch <= "9") || ch === ".") { out += ch; continue; }
    if (ch === "/") {
      if (allowSlash) { out += ch; continue; }
      throw new Error("VIC：'/' 为保留字符（数字 shift / 对半标记），用户文本不可包含。");
    }
    throw new Error(`VIC：输入含不支持的字符 "${ch}"（只支持字母、数字、'.'，空格自动丢弃）。`);
  }
  if (!out) throw new Error("VIC：输入不含任何可用字符。");
  return out;
}

const DEF = {
  phrase: "'Twas the night before Christmas",
  date: "139195",
  personal: 6,
  keygroup: "72401",
  mnemonic: "ATONESIR",
  cut: 0,
};

function vicParams(p) {
  const q = p || {};
  return {
    phrase: q.phrase != null ? q.phrase : DEF.phrase,
    date: q.date != null ? q.date : DEF.date,
    personal: q.personal != null ? q.personal : DEF.personal,
    keygroup: q.keygroup != null ? q.keygroup : DEF.keygroup,
    mnemonic: q.mnemonic != null ? q.mnemonic : DEF.mnemonic,
    cut: Number(q.cut != null ? q.cut : DEF.cut) || 0,
  };
}

function vicEncode(text, p) {
  const cfg = vicParams(p);
  const keys = deriveVicKeys(cfg.phrase, cfg.date, cfg.personal, cfg.keygroup);
  let msg = vicNorm(text, false);
  if (cfg.cut > 0) msg = msg.slice(cfg.cut) + "/" + msg.slice(0, cfg.cut);
  let digits = vicCheckerboardEncode(msg, keys.S, cfg.mnemonic);
  // 自校验：棋盘输出必须能精确解回（防对半标记与数字段的结构性歧义）
  if (vicCheckerboardDecode(digits, keys.S, cfg.mnemonic) !== msg)
    throw new Error("VIC：该输入在棋盘层产生结构歧义（标记/数字段相撞），请更换 cut 或去掉数字。");
  const s1 = columnarTranspose(digits, keys.Q, false);
  const s2 = diagonalTranspose(s1, keys.R, false);
  return s2.replace(/(.{5})/g, "$1 ").trim();
}

function vicDecode(text, p) {
  const cfg = vicParams(p);
  const keys = deriveVicKeys(cfg.phrase, cfg.date, cfg.personal, cfg.keygroup);
  const raw = String(text == null ? "" : text);
  for (const ch of raw) if (!(ch >= "0" && ch <= "9") && ch !== " ")
    throw new Error(`VIC：密文只允许数字与空格（含 "${ch}"）。`);
  const digits = [...raw].filter((c) => c >= "0" && c <= "9").join("");
  if (!digits) throw new Error("VIC：密文为空。");
  if (keys.widths[0] + keys.widths[1] > 50) throw new Error("VIC：换位宽度和超过 50 位密钥流。");
  const s1 = diagonalTranspose(digits, keys.R, true);
  const s0 = columnarTranspose(s1, keys.Q, true);
  let msg = vicCheckerboardDecode(s0, keys.S, cfg.mnemonic);
  const cut = msg.indexOf("/");
  if (cut >= 0) msg = msg.slice(cut + 1) + msg.slice(0, cut);
  return msg;
}

register({
  id: "vic", cat: "classic", name: "VIC 密码",
  desc: "冷战铅笔密码：短语+日期+个人号+密钥组 链式相加派生密钥流 → 跨行棋盘化 → 列换位+三角扰乱双换位；默认即 Wikipedia 例（派生线 A-S 可复现）",
  params: [
    { sensitive: true, key: "phrase", label: "口令短语（≥20 字母）", type: "password", default: DEF.phrase },
    { key: "date", label: "日期（≥6 位数字，前 5 位入钥）", type: "text", default: DEF.date },
    { key: "personal", label: "个人号（1-99）", type: "number", default: DEF.personal },
    { key: "keygroup", label: "密钥组（5 位数字）", type: "text", default: DEF.keygroup },
    { key: "mnemonic", label: "高频字母口诀（8 个互异字母）", type: "text", default: DEF.mnemonic },
    { key: "cut", label: "对半倒置切点（0=关闭）", type: "number", default: DEF.cut },
  ],
  encode: (t, p) => vicEncode(t, p),
  decode: (t, p) => vicDecode(t, p),
});

export {
  vicEncode, vicDecode, deriveVicKeys, buildCheckerboard,
  vicCheckerboardEncode, vicCheckerboardDecode,
  columnarTranspose, diagonalTranspose,
  chainAdd, sequence, seqDigits, seqLetters, subMod10, addMod10, digitEncode,
};
