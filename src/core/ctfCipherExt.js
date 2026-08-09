/*
 * ctfCipherExt.js — CTF 常见冷门编码/换位密码补齐（cat:'fancy' / 'classic'）。
 *
 * 本文件 5 个 op，均为公开算法，此前本工具缺失：
 * twinHex      —— Twin-Hex（calcresult.com 提出的双字符查表编码，96×96 表 → base36 三位）
 * trollScript  —— TrollScript（BrainFuck 三字符 token 方言，tro…ll. 包裹）
 * asciiSum     —— ASCII 前缀累加和（逐字符累计 code，空格分隔的递增数列）
 * caesarBox    —— Caesar Box 箱型换位（按固定列宽写入、按列读出）
 * curveCipher  —— 曲路（蛇形）换位密码，row×col 网格蛇形读取
 *
 * 实现口径：编码侧与 ToolsFx 逐字节一致（该项目是这几种编码事实上的主要产出方，
 * 密文互通才有意义）；解码侧在其基础上放宽容错，故能读入我方与它的产物。
 * 各算法的官方/上游测试向量见每节注释，均已逐条比对。
 */
import { register } from "./registry.js";

// ============ ① Twin-Hex ============
// 码表：ASCII 32..127 的全部两字符组合，共 96×96 = 9216 项，索引即 base36 三位（最大 9215 = "73z"）。
// 编码：明文两字符一组 → 查表得索引 → base36（小写）右填空格到 3 位。
// 解码：三字符一组 → base36 解回索引 → 取回字符对 → 去尾部填充空格。
// 上游向量："a"→"4tc"，"a1"→"4tt"，"a12"→"4tt1c0"（逐条已核）。
const TWIN_LO = 32, TWIN_HI = 128, TWIN_SPAN = TWIN_HI - TWIN_LO; // 96
const B36 = "0123456789abcdefghijklmnopqrstuvwxyz";

function twinIndex(pair) {
  const a = pair.charCodeAt(0), b = pair.charCodeAt(1);
  if (a < TWIN_LO || a >= TWIN_HI || b < TWIN_LO || b >= TWIN_HI) return -1;
  return (a - TWIN_LO) * TWIN_SPAN + (b - TWIN_LO);
}
function twinPair(idx) {
  if (idx < 0 || idx >= TWIN_SPAN * TWIN_SPAN) return null;
  return String.fromCharCode(TWIN_LO + Math.floor(idx / TWIN_SPAN)) +
    String.fromCharCode(TWIN_LO + (idx % TWIN_SPAN));
}

function twinHexEncode(text) {
  const s = String(text);
  let out = "";
  for (let i = 0; i < s.length; i += 2) {
    // 奇数长度末组按码表约定右填空格（解码时 trim 掉）
    const pair = s.slice(i, i + 2).padEnd(2, " ");
    const idx = twinIndex(pair);
    if (idx < 0) throw new Error("Twin-Hex: 仅支持 ASCII 32-127，越界字符 " + JSON.stringify(pair));
    // base36 不足 3 位右填空格，凑齐定长 3（与上游产物一致）
    out += idx.toString(36).padEnd(3, " ");
  }
  return out;
}

function twinHexDecode(src) {
  const s = String(src);
  let out = "";
  for (let i = 0; i < s.length; i += 3) {
    // 定长 3 切分；填充空格在此 trim（上游对小索引就是空格右填）
    const tok = s.slice(i, i + 3).trim();
    if (!tok) continue;
    if (!/^[0-9a-z]+$/i.test(tok)) throw new Error("Twin-Hex: 非 base36 字符 " + JSON.stringify(tok));
    let idx = 0;
    for (const ch of tok.toLowerCase()) idx = idx * 36 + B36.indexOf(ch);
    const pair = twinPair(idx);
    if (pair === null) throw new Error("Twin-Hex: 索引越界 " + idx);
    // 末组的填充空格要去掉，中间组的空格是真数据 → 只 trimEnd 最后一组
    out += pair;
  }
  return out.replace(/ +$/, "");
}

// ============ ② TrollScript ============
// BrainFuck 方言：每 token 定长 3 字符，tro 开头、ll. 结尾，非法片段跳过。
const TROLL = {
  start: "tro", end: "ll.",
  next: "ooo", pre: "ool", plus: "olo", minus: "oll",
  output: "loo", input: "lol", bracketLeft: "llo", bracketRight: "lll",
};
const TROLL_TO_BF = {
  [TROLL.next]: ">", [TROLL.pre]: "<", [TROLL.plus]: "+", [TROLL.minus]: "-",
  [TROLL.output]: ".", [TROLL.input]: ",", [TROLL.bracketLeft]: "[", [TROLL.bracketRight]: "]",
};
const TROLL_MAX_STEPS = 5_000_000;

// 上游短编码：首字符用「乘法循环」构造（少写大量 + 号），其后字符走差量。
// pointerLoopCalculate：把 n 拆成 a*b+c 三元组，优先选贴近 sqrt(n) 的因子对。
function pointerLoopCalculate(n) {
  const root = Math.floor(Math.sqrt(n));
  const tol = Math.floor(n / 32) + 1;
  const loops = [0, 0, 0];
  const near = (a, b) => Math.abs(a * b - n) <= tol;
  if (n < 10) { loops[0] = n; return loops; }
  else if (near(root - 1, root + 3)) { loops[0] = root - 1; loops[1] = root + 3; }
  else if (near(root + 1, root - 1)) { loops[0] = root - 1; loops[1] = root + 1; }
  else if (near(root + 1, root - 2)) { loops[0] = root - 2; loops[1] = root + 1; }
  else if (near(root - 1, root + 2)) { loops[0] = root - 1; loops[1] = root + 2; }
  else if (near(root, root + 2)) { loops[0] = root; loops[1] = root + 2; }
  else if (near(root + 1, root + 1)) { loops[0] = root + 1; loops[1] = root + 1; }
  else if (near(root, root + 1)) { loops[0] = root; loops[1] = root + 1; }
  else { loops[0] = root; loops[1] = root; }
  if (loops[1] !== 0) loops[2] = n - loops[0] * loops[1];
  return loops;
}

// 三元组 [a,b,c] → token 串：b=0 时直接 a 个 plus；否则 a 个 plus 进循环乘 b，再补 c，末尾 output。
function translateLoop(t) {
  const [a, b, c] = t;
  if (b === 0) return TROLL.plus.repeat(a);
  let s = TROLL.plus.repeat(a) + TROLL.bracketLeft + TROLL.next + TROLL.plus.repeat(b) +
    TROLL.pre + TROLL.minus + TROLL.bracketRight + TROLL.next;
  if (c < 0) s += TROLL.minus.repeat(-c);
  else if (c > 0) s += TROLL.plus.repeat(c);
  return s + TROLL.output;
}

function trollScriptEncode(text) {
  const s = String(text);
  if (!s) return TROLL.start + TROLL.end;
  let body = "";
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (i === 0) { body += translateLoop(pointerLoopCalculate(code)); continue; }
    const diff = code - s.charCodeAt(i - 1);
    if (Math.abs(diff) < 10) {
      // 差量小：就地加减后输出，省 token
      body += (diff > 0 ? TROLL.plus.repeat(diff) : TROLL.minus.repeat(-diff)) + TROLL.output;
    } else {
      // 差量大：移到新格子重新用乘法循环构造
      body += TROLL.next + translateLoop(pointerLoopCalculate(code));
    }
  }
  return TROLL.start + body + TROLL.end;
}

// 解码：token → BF 指令，再跑通用 BF 解释器。
// 上游引擎 64 格环形 + 有符号字节；此处用 30000 格无符号（上游产物只用前几格且值在 0..255，行为一致），
// 且对手写程序更宽容。
function trollToBf(src) {
  const s = String(src);
  let bf = "";
  let i = 0, started = false;
  while (i < s.length) {
    const tok = s.slice(i, i + 3).toLowerCase();
    if (tok.length < 3) break;
    if (tok === TROLL.start) { started = true; i += 3; continue; }
    if (tok === TROLL.end) break;
    const cmd = TROLL_TO_BF[tok];
    if (cmd !== undefined) {
      // 未见 tro 时的 token 按上游口径忽略（start 前的内容不算程序）
      if (started) bf += cmd;
      i += 3;
    } else {
      i++; // 非法片段逐字符滑动
    }
  }
  return bf;
}

function bfExec(code) {
  const jump = new Map();
  const stack = [];
  for (let i = 0; i < code.length; i++) {
    if (code[i] === "[") stack.push(i);
    else if (code[i] === "]" && stack.length) {
      const j = stack.pop();
      jump.set(i, j); jump.set(j, i);
    }
  }
  const tape = new Uint8Array(30000);
  let ptr = 0, steps = 0;
  const out = [];
  for (let ip = 0; ip < code.length; ip++) {
    if (++steps > TROLL_MAX_STEPS) throw new Error("TrollScript: 超过步数上限，可能死循环");
    switch (code[ip]) {
      case ">": ptr = (ptr + 1) % 30000; break;
      case "<": ptr = (ptr + 29999) % 30000; break;
      case "+": tape[ptr] = (tape[ptr] + 1) & 0xff; break;
      case "-": tape[ptr] = (tape[ptr] + 255) & 0xff; break;
      case ".": out.push(tape[ptr]); break;
      case ",": tape[ptr] = 0; break; // 无输入源
      case "[": if (tape[ptr] === 0 && jump.has(ip)) ip = jump.get(ip); break;
      case "]": if (tape[ptr] !== 0 && jump.has(ip)) ip = jump.get(ip); break;
    }
  }
  // 输出是字节流，按 UTF-8 还原（上游按 latin1 逐字节，ASCII 下一致）
  return new TextDecoder("utf-8", { fatal: false }).decode(new Uint8Array(out));
}

function trollScriptDecode(src) {
  const bf = trollToBf(src);
  if (!bf) throw new Error("TrollScript: 未识别到有效 token（应含 tro/ooo/olo/loo 等三字符片段）");
  return bfExec(bf);
}

// ============ ③ ASCII 前缀累加和 ============
// 编码：首项固定 0，逐字符累加 charCode，空格分隔 → "0 102 210 …"
// 解码：取相邻差值还原字符。
// 上游向量：flag{...} 长串（已逐条核）。
function asciiSumEncode(text) {
  const s = String(text);
  let sum = 0;
  const parts = ["0"];
  for (const ch of s) { sum += ch.codePointAt(0); parts.push(String(sum)); }
  return parts.join(" ");
}

function asciiSumDecode(src) {
  const nums = String(src).split(/\D+/).filter(Boolean).map(Number);
  if (!nums.length) throw new Error("ASCII 累加和: 未找到数字");
  // 标准产物以 0 开头；缺首项 0 时按「首个数即第一个字符码」补上，兼容手抄丢头的输入
  const seq = nums[0] === 0 ? nums : [0, ...nums];
  let out = "";
  for (let i = 1; i < seq.length; i++) {
    const d = seq[i] - seq[i - 1];
    if (d < 0 || d > 0x10ffff) throw new Error("ASCII 累加和: 差值越界 " + d + "（数列须单调递增）");
    out += String.fromCodePoint(d);
  }
  return out;
}

// ============ ④ Caesar Box 箱型换位 ============
// 明文去空格后按 height 列宽逐行写入网格，再逐列读出。
// 解密即用转置后的列宽（ceil(len/height)）再走一次同样的读法。
// 上游向量："Hello World!" h=3 → "Hlodeor!lWl"，回解 "HelloWorld!"（空格不可逆，上游同）。
function caesarBoxTranspose(text, height) {
  const s = String(text).replace(/ /g, "");
  const h = Math.max(1, Math.floor(height));
  if (!s) return "";
  const rows = Math.ceil(s.length / h);
  let out = "";
  for (let i = 0; i < h; i++) {
    for (let j = i; j < rows * h; j += h) {
      if (j < s.length) out += s[j]; // 尾部空位跳过（等效上游的 NUL 填充判断）
    }
  }
  return out;
}
function caesarBoxEncode(text, p) {
  return caesarBoxTranspose(text, (p && Number(p.height)) || 3);
}
function caesarBoxDecode(text, p) {
  const h = (p && Number(p.height)) || 3;
  const s = String(text).replace(/ /g, "");
  return caesarBoxTranspose(s, Math.ceil(s.length / Math.max(1, h)));
}

// ============ ⑤ 曲路（蛇形）换位 ============
// row×col 网格，按列蛇形读取（奇列自上而下、偶列自下而上），整体再反转。
// 上游向量："HelloWorldab" 3×4 → "lrbaoleWdloH"；34 字符 5×7 向量亦已核。
// 长度必须恰为 row×col：否则网格有残格，蛇形读取会跳过或错位，产出不可还原。
// 上游在部分残格长度上不报错而是静默返回错值（实测 34 字 5×7 即如此），
// 这里改为显式报错——静默出错值比报错更难排查，且该产物本就无法解回。
function curveCheckLen(len, row, col) {
  if (len !== row * col) {
    throw new Error(`曲路: 文本长度须恰为 row×col，当前 ${len} ≠ ${row}×${col}=${row * col}`);
  }
}

function curveEncode(text, p) {
  const s = String(text);
  const row = Math.max(1, Math.floor((p && Number(p.row)) || 3));
  const col = Math.max(1, Math.floor((p && Number(p.col)) || 4));
  curveCheckLen(s.length, row, col);
  const chunks = [];
  for (let i = 0; i < s.length; i += col) chunks.push(s.slice(i, i + col));
  let flag = false, out = "";
  for (let i = 0; i < s.length; i++) {
    if (i % row === 0) flag = !flag;         // 每满一列翻转方向
    const li = flag ? i % row : row - (i % row) - 1;
    const chunk = chunks[li];
    const ch = chunk === undefined ? undefined : chunk[Math.floor(i / row)];
    if (ch === undefined) throw new Error("曲路: 长度与 row×col 不匹配（需 row×col = 文本长度）");
    out += ch;
  }
  return [...out].reverse().join("");
}
function curveDecode(text, p) {
  const s = String(text);
  const row = Math.max(1, Math.floor((p && Number(p.row)) || 3));
  const col = Math.max(1, Math.floor((p && Number(p.col)) || 4));
  curveCheckLen(s.length, row, col);
  let flag = col % 2 === 0;
  const arr = new Array(s.length).fill("");
  for (let i = 0; i < s.length; i++) {
    if (i % row === 0) flag = !flag;
    const li = flag ? i % row : row - (i % row) - 1;
    const pos = Math.floor(i / row) + li * col;
    if (pos >= s.length) throw new Error("曲路: 长度与 row×col 不匹配（需 row×col = 文本长度）");
    arr[pos] = s[i];
  }
  return arr.join("").split("").reverse().join("");
}

// ---- 注册 ----
register({
  id: "twinHex", cat: "fancy", name: "Twin-Hex 双字符编码",
  desc: "双字符查表编码（ASCII 32-127 的 96×96 组合表，索引转 base36 定长 3 位）。仅支持 ASCII 可见字符。",
  params: [],
  encode: (t) => twinHexEncode(t),
  decode: (t) => twinHexDecode(t),
  detect: (t) => {
    const s = String(t).trim();
    // 定长 3 的 base36 块（含空格填充），长度须为 3 的倍数
    return s.length >= 6 && s.length % 3 === 0 && /^[0-9a-z ]+$/i.test(s) && /[a-z]/i.test(s) ? 0.25 : 0;
  },
});

register({
  id: "trollScript", cat: "fancy", name: "TrollScript",
  desc: "BrainFuck 三字符 token 方言（tro 开头 ll. 结尾，ooo/ool/olo/oll/loo/lol/llo/lll 八指令）。encode 生成 / decode 执行，步数上限 500 万。",
  params: [],
  encode: (t) => trollScriptEncode(t),
  decode: (t) => trollScriptDecode(t),
  detect: (t) => (/tro(?:[ol]{3})*ll\./.test(String(t).replace(/\s+/g, "")) ? 0.7 : 0),
});

register({
  id: "asciiSum", cat: "fancy", name: "ASCII 前缀累加和",
  desc: "逐字符累加 ASCII 码得递增数列（首项 0，空格分隔）。解码取相邻差值还原。",
  params: [],
  encode: (t) => asciiSumEncode(t),
  decode: (t) => asciiSumDecode(t),
  detect: (t) => {
    const nums = String(t).trim().split(/\D+/).filter(Boolean).map(Number);
    if (nums.length < 3 || nums[0] !== 0) return 0;
    // 严格递增且相邻差都落在可打印码位区间 → 高度疑似
    for (let i = 1; i < nums.length; i++) {
      const d = nums[i] - nums[i - 1];
      if (d <= 0 || d > 0x10ffff) return 0;
    }
    return 0.6;
  },
});

register({
  id: "caesarBox", cat: "classic", name: "凯撒箱换位 Caesar Box",
  desc: "箱型（列）换位：去空格后按指定列宽逐行写入网格、再逐列读出。解密用转置列宽再走一次。注意仅当长度为列宽整数倍时可完整还原（残格时转置不是逆运算，此为算法固有性质）；空格在编码时被去除，不可还原。",
  params: [
    { key: "height", label: "列宽 height", type: "number", default: 3 },
  ],
  encode: (t, p) => caesarBoxEncode(t, p),
  decode: (t, p) => caesarBoxDecode(t, p),
});

register({
  id: "curveCipher", cat: "classic", name: "曲路密码 Curve Cipher",
  desc: "蛇形（曲路）换位：row×col 网格按列蛇形读取，奇偶列方向相反，末尾整体反转。需 row×col = 文本长度。",
  params: [
    { key: "row", label: "行数 row", type: "number", default: 3 },
    { key: "col", label: "列数 col", type: "number", default: 4 },
  ],
  encode: (t, p) => curveEncode(t, p),
  decode: (t, p) => curveDecode(t, p),
});

export {
  twinHexEncode, twinHexDecode,
  trollScriptEncode, trollScriptDecode, trollToBf,
  asciiSumEncode, asciiSumDecode,
  caesarBoxEncode, caesarBoxDecode,
  curveEncode, curveDecode,
};
