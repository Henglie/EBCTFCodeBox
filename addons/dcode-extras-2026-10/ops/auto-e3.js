/*
 * dcode-extras · Agent E3 批次（2026-10）
 *
 * 范围：D3 遗留的 41 个 blocked 条目中可确定性实现的部分，外加 D3 只做“组合枚举”的 Kakuro 整盘求解。
 * 纪律：
 * - 只用纯 JS、用户输入或自带词表；不联网、不内置私有答案库/版权词典。
 * - 求解器全部有界（节点/结果/时间），超限显式报错，不静默截断。
 * - 图片/OCR/音频/运营商库/DNS/专有规则库仍然 blocked，并写明原因。
 * - 每个 e3-* op 在 tests/auto-e3.selftest.mjs 中有已知向量/往返/结构断言。
 *
 * 台账：41 个 D3 blocked 重审 + 1 个 Kakuro 升级 = 42 条；
 *       12 implemented / 7 mapped / 23 blocked。
 */

import { runOp, parseList } from "../lib/util.js";

const CAT_GAME = "dcode-extras-2026-10/cat-game";
const CAT_TEXT = "dcode-extras-2026-10/cat-text";
const CAT_NUM = "dcode-extras-2026-10/cat-numeral";

const P = (key, label, ph) => ({ key, label, type: "text", default: "", placeholder: ph || "" });
const SEL = (key, label, def, opts) => ({ key, label, type: "select", default: def, options: opts.map((o) => (typeof o === "string" ? { value: o, label: o } : o)) });

function linesOf(text) {
  return String(text == null ? "" : text).split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
}

function compactRows(text) {
  return linesOf(text).map((l) => l.replace(/[\s,]+/g, ""));
}

function splitDoc(text) {
  const s = String(text == null ? "" : text);
  const parts = s.split(/^\s*={3,}\s*$/m);
  const main = parts[0].trim();
  const tail = parts.slice(1).join("\n").trim();
  return { main, tail, words: tail ? parseList(tail).map((w) => w.toLowerCase()).filter(Boolean) : null };
}

function requireWords(tail, opName) {
  const words = tail ? parseList(tail).map((w) => w.toLowerCase()).filter(Boolean) : [];
  if (!words.length) throw new Error(`${opName} 需要 === 后提供词表（每行一词）`);
  return words;
}

function popcount(x) {
  x = x - ((x >> 1) & 0x55555555);
  x = (x & 0x33333333) + ((x >> 2) & 0x33333333);
  x = (x + (x >> 4)) & 0x0f0f0f0f;
  return (x * 0x01010101) >> 24;
}

function permutations(n) {
  const a = Array.from({ length: n }, (_, i) => i);
  const out = [];
  const rec = (k) => {
    if (k === n) { out.push(a.slice()); return; }
    for (let i = k; i < n; i++) {
      [a[k], a[i]] = [a[i], a[k]];
      rec(k + 1);
      [a[k], a[i]] = [a[i], a[k]];
    }
  };
  rec(0);
  return out;
}

// =====================================================================================
// 1. Fill-A-Pix / Mosaic
// =====================================================================================
function parseFillapix(main) {
  const rows = compactRows(main).map((r) => r.split(""));
  if (rows.length < 2 || rows.length > 30) throw new Error("Fill-A-Pix 网格需 2..30 行");
  const C = rows[0] ? rows[0].length : 0;
  if (C < 2 || C > 30 || !rows.every((r) => r.length === C)) throw new Error("Fill-A-Pix 网格需行列一致，列数 2..30");
  if (rows.length * C > 900) throw new Error("Fill-A-Pix 网格总格数需 ≤900");
  return rows;
}

function solveFillapix(rows, includeCenter) {
  const R = rows.length, C = rows[0].length, N = R * C;
  const fixed = new Int8Array(N).fill(-1);
  const clues = [];
  for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
    const ch = rows[r][c];
    const idx = r * C + c;
    if (/[0-9]/.test(ch)) {
      const cells = [];
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        if (!includeCenter && dr === 0 && dc === 0) continue;
        const nr = r + dr, nc = c + dc;
        if (nr >= 0 && nc >= 0 && nr < R && nc < C) cells.push(nr * C + nc);
      }
      const target = Number(ch);
      if (target > cells.length) throw new Error(`线索 ${ch} 在 (${r + 1},${c + 1}) 超过窗口格数 ${cells.length}`);
      clues.push({ cells, target, r, c });
    } else if (/[#Xx]/.test(ch)) {
      fixed[idx] = 1;
    } else if (/[.?_]/.test(ch)) {
      // 未知
    } else {
      throw new Error(`未知格子「${ch}」`);
    }
  }
  if (!clues.length) throw new Error("至少需要一个数字线索");
  const consByVar = Array.from({ length: N }, () => []);
  clues.forEach((con, ci) => { for (const idx of con.cells) consByVar[idx].push(ci); });

  const assign = new Int8Array(N).fill(-1);
  for (let i = 0; i < N; i++) if (fixed[i] >= 0) assign[i] = fixed[i];

  function setVal(a, trail, idx, v) {
    if (a[idx] === v) return true;
    if (a[idx] >= 0) return false;
    a[idx] = v; trail.push(idx); return true;
  }
  function undo(a, trail) { for (let i = trail.length - 1; i >= 0; i--) a[trail[i]] = -1; }

  function propagate(a, trail) {
    let changed = true;
    while (changed) {
      changed = false;
      for (const con of clues) {
        let sum = 0; const un = [];
        for (const idx of con.cells) {
          const v = a[idx];
          if (v < 0) un.push(idx); else sum += v;
        }
        if (sum > con.target || sum + un.length < con.target) return false;
        if (!un.length) { if (sum !== con.target) return false; continue; }
        if (sum === con.target) {
          for (const idx of un) { if (!setVal(a, trail, idx, 0)) return false; }
          changed = true;
        } else if (sum + un.length === con.target) {
          for (const idx of un) { if (!setVal(a, trail, idx, 1)) return false; }
          changed = true;
        }
      }
    }
    return true;
  }

  let nodes = 0;
  function search(a) {
    if (++nodes > 2000000) throw new Error("Fill-A-Pix 搜索超 2e6 节点，请缩小网格");
    const trail = [];
    if (!propagate(a, trail)) { undo(a, trail); return false; }
    let best = -1, bestScore = -1;
    for (let i = 0; i < N; i++) {
      if (a[i] < 0 && consByVar[i].length > bestScore) { best = i; bestScore = consByVar[i].length; }
    }
    if (best < 0) return true;
    if (bestScore === 0) {
      for (let i = 0; i < N; i++) if (a[i] < 0) a[i] = 0;
      return true;
    }
    for (const v of [0, 1]) {
      const t = [];
      if (setVal(a, t, best, v) && search(a)) return true;
      undo(a, t);
    }
    undo(a, trail);
    return false;
  }

  if (!search(assign)) throw new Error("无解（线索矛盾或在固定格限制下不可满足）");
  return { R, C, assign, clues };
}

const opFillapix = runOp(
  "e3-fillapix", CAT_GAME,
  "Fill-A-Pix / Mosaic 求解",
  "数字线索表示以该格为中心的 3×3 窗口（默认含自身）中涂黑格数；回溯+约束传播求一个解。输入每行数字 0..9 / . ? _ 未知 / # X 预涂黑。覆盖 Fill-A-Pix、Mosaic、Picture Paint 类数字填格",
  (t, p) => {
    const { main } = splitDoc(t);
    const rows = parseFillapix(main);
    const includeCenter = String((p && p.center) || "include") !== "exclude";
    const { R, C, assign, clues } = solveFillapix(rows, includeCenter);
    const out = [];
    for (let r = 0; r < R; r++) {
      let line = "";
      for (let c = 0; c < C; c++) line += assign[r * C + c] === 1 ? "#" : ".";
      out.push(line);
    }
    return `Fill-A-Pix ${R}×${C} 解（#=涂黑，.=空白）：\n${out.join("\n")}\n线索 ${clues.length} 条全部满足（窗口${includeCenter ? "含" : "不含"}中心格）`;
  },
  [SEL("center", "线索窗口是否含中心格", "include", [{ value: "include", label: "含中心格（标准 3×3）" }, { value: "exclude", label: "不含中心格（仅 8 邻域）" }])]
);

// =====================================================================================
// 2. Tectonic / Suguru
// =====================================================================================
function parseTectonicDoc(text) {
  const { main, tail } = splitDoc(text);
  const ls = linesOf(main);
  if (!ls.length) throw new Error("第一行给阶数 n");
  const n = Number(ls[0]);
  if (!Number.isInteger(n) || n < 2 || n > 12) throw new Error("阶数需 2..12");
  const regLines = ls.slice(1, 1 + n);
  if (regLines.length !== n) throw new Error(`需要 ${n} 行区域图`);
  const reg = regLines.map((l) => l.replace(/[\s,]+/g, ""));
  if (reg.some((r) => r.length !== n)) throw new Error("区域图每行需 n 个字符");
  const givenLines = linesOf(tail).slice(0, n);
  if (givenLines.length !== n) throw new Error(`=== 后需要 ${n} 行提示数（. 为空）`);
  const givens = givenLines.map((l) => l.replace(/[\s,]+/g, ""));
  if (givens.some((r) => r.length !== n)) throw new Error("提示图每行需 n 个字符");
  return { n, reg, givens };
}

function solveTectonic(n, reg, givens) {
  const N = n * n;
  const regionMap = new Map();
  const regionOf = new Int16Array(N);
  const regionCells = [];
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    const ch = reg[r][c];
    if (!regionMap.has(ch)) { regionMap.set(ch, regionCells.length); regionCells.push([]); }
    const id = regionMap.get(ch);
    regionOf[r * n + c] = id;
    regionCells[id].push(r * n + c);
  }
  for (const cells of regionCells) if (cells.length > 9) throw new Error("区域大小需 ≤9（单数字提示）");
  const sizes = regionCells.map((x) => x.length);
  const assign = new Int8Array(N).fill(-1);
  const orth = new Set(["-1,0", "1,0", "0,-1", "0,1"]);
  const dirs = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    const ch = givens[r][c];
    if (ch === "." || ch === "_" || ch === "?") continue;
    if (!/^[1-9]$/.test(ch)) throw new Error(`提示「${ch}」需为 1..9 或 .`);
    const v = Number(ch);
    const idx = r * n + c;
    if (v > sizes[regionOf[idx]]) throw new Error(`(${r + 1},${c + 1}) 的 ${v} 超过区域大小 ${sizes[regionOf[idx]]}`);
    assign[idx] = v;
  }

  function allowedAt(a, r, c) {
    const idx = r * n + c;
    let mask = ((1 << (sizes[regionOf[idx]] + 1)) - 1) & ~1;
    for (const [dr, dc] of dirs) {
      const nr = r + dr, nc = c + dc;
      if (nr < 0 || nc < 0 || nr >= n || nc >= n) continue;
      const w = a[nr * n + nc];
      if (w < 0) continue;
      if (w === 0) continue;
      if (w === a[idx]) { /* 自身未赋值时不可能相等 */ }
      if (w > 0) {
        mask &= ~(1 << w);
        if (orth.has(dr + "," + dc)) {
          if (w > 1) mask &= ~(1 << (w - 1));
          if (w < 9) mask &= ~(1 << (w + 1));
        }
      }
    }
    for (const jdx of regionCells[regionOf[idx]]) {
      const w = a[jdx];
      if (jdx !== idx && w > 0) mask &= ~(1 << w);
    }
    return mask;
  }

  function propagate(a) {
    let changed = true;
    while (changed) {
      changed = false;
      for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
        const idx = r * n + c;
        if (a[idx] >= 0) continue;
        const mask = allowedAt(a, r, c);
        if (mask === 0) return false;
        if (popcount(mask) === 1) { a[idx] = 31 - Math.clz32(mask); changed = true; }
      }
    }
    return true;
  }

  let nodes = 0;
  function search(a) {
    if (++nodes > 2000000) throw new Error("Tectonic 搜索超 2e6 节点，请缩小网格或增加提示");
    if (!propagate(a)) return null;
    let best = -1, bestMask = 0, bestCount = 99;
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
      const idx = r * n + c;
      if (a[idx] >= 0) continue;
      const mask = allowedAt(a, r, c);
      const cnt = popcount(mask);
      if (cnt < bestCount) { best = idx; bestMask = mask; bestCount = cnt; if (cnt === 1) break; }
    }
    if (best < 0) return a;
    for (let v = 1; v <= 9; v++) {
      if (!(bestMask & (1 << v))) continue;
      const next = a.slice();
      next[best] = v;
      const got = search(next);
      if (got) return got;
    }
    return null;
  }

  const got = search(assign);
  if (!got) throw new Error("无解（区域/相邻约束矛盾）");
  return { n, solution: got, sizes };
}

const opTectonic = runOp(
  "e3-tectonic", CAT_GAME,
  "Tectonic / Suguru 求解",
  "不规则区域填数：每格取 1..区域大小，区域内不重复；8 邻域不重复；正交相邻不连续。输入：阶数 n、n 行区域图、===、n 行提示（1..9 或 .）。覆盖 Tectonic、Suguru、Number Blocks",
  (t) => {
    const { n, reg, givens } = parseTectonicDoc(t);
    const { solution, sizes } = solveTectonic(n, reg, givens);
    const rows = [];
    for (let r = 0; r < n; r++) {
      const row = [];
      for (let c = 0; c < n; c++) row.push(String(solution[r * n + c]));
      rows.push(row.join(" "));
    }
    return `Tectonic ${n}×${n} 解（区域大小 ${sizes.join(",")}）：\n${rows.join("\n")}\n校验：区域唯一、8 邻域不重复、正交相邻不连续`;
  }
);

// =====================================================================================
// 3. 任意区域 Sudoku（5×5 / 7×7 / 不规则 N×N）
// =====================================================================================
function parseSudokuRegions(text) {
  const { main, tail } = splitDoc(text);
  const ls = linesOf(main);
  if (!ls.length) throw new Error("第一行给阶数 n");
  const n = Number(ls[0]);
  if (!Number.isInteger(n) || n < 2 || n > 16) throw new Error("阶数需 2..16");
  const regLines = ls.slice(1, 1 + n);
  if (regLines.length !== n) throw new Error(`需要 ${n} 行区域图`);
  const reg = regLines.map((l) => l.replace(/[\s,]+/g, ""));
  if (reg.some((r) => r.length !== n)) throw new Error("区域图每行需 n 个字符");
  const givenLines = linesOf(tail).slice(0, n);
  if (givenLines.length !== n) throw new Error(`=== 后需要 ${n} 行提示（. _ ? 为空）`);
  const givens = givenLines.map((l) => l.replace(/[\s,]+/g, ""));
  if (givens.some((r) => r.length !== n)) throw new Error("提示图每行需 n 个字符");
  return { n, reg, givens };
}

function sudokuCharToVal(ch, n) {
  if (ch === "." || ch === "_" || ch === "?") return 0;
  if (ch === "0") return n >= 10 ? 10 : 0;
  if (/^[1-9]$/.test(ch)) return Number(ch);
  const up = ch.toUpperCase();
  if (up >= "A" && up <= "G") return 10 + up.charCodeAt(0) - 65;
  return -1;
}

function sudokuValToChar(v) {
  if (v <= 9) return String(v);
  return String.fromCharCode(65 + v - 10);
}

function solveRegionSudoku(n, reg, givens) {
  const N = n * n;
  const regionMap = new Map();
  const regionOf = new Int16Array(N);
  const regionCells = [];
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    const ch = reg[r][c];
    if (!regionMap.has(ch)) { regionMap.set(ch, regionCells.length); regionCells.push([]); }
    const id = regionMap.get(ch);
    regionOf[r * n + c] = id;
    regionCells[id].push(r * n + c);
  }
  for (const cells of regionCells) if (cells.length > n) throw new Error("每个区域大小需 ≤n");
  const fullMask = (1 << (n + 1)) - 2;
  const assign = new Int16Array(N).fill(-1);
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    const v = sudokuCharToVal(givens[r][c], n);
    if (v < 0) throw new Error(`提示「${givens[r][c]}」不在字符集内`);
    assign[r * n + c] = v === 0 ? -1 : v;
  }

  function allowedAt(a, r, c) {
    let mask = fullMask;
    for (let cc = 0; cc < n; cc++) {
      const w = a[r * n + cc];
      if (w > 0) mask &= ~(1 << w);
    }
    for (let rr = 0; rr < n; rr++) {
      const w = a[rr * n + c];
      if (w > 0) mask &= ~(1 << w);
    }
    for (const jdx of regionCells[regionOf[r * n + c]]) {
      const w = a[jdx];
      if (w > 0) mask &= ~(1 << w);
    }
    return mask;
  }

  function propagate(a) {
    let changed = true;
    while (changed) {
      changed = false;
      for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
        const idx = r * n + c;
        if (a[idx] >= 0) continue;
        const mask = allowedAt(a, r, c);
        if (mask === 0) return false;
        if (popcount(mask) === 1) { a[idx] = 31 - Math.clz32(mask); changed = true; }
      }
    }
    return true;
  }

  let nodes = 0;
  function search(a) {
    if (++nodes > 3000000) throw new Error("数独搜索超 3e6 节点，请增加提示或缩小阶数");
    if (!propagate(a)) return null;
    let best = -1, bestMask = 0, bestCount = 99;
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
      const idx = r * n + c;
      if (a[idx] >= 0) continue;
      const mask = allowedAt(a, r, c);
      const cnt = popcount(mask);
      if (cnt < bestCount) { best = idx; bestMask = mask; bestCount = cnt; if (cnt === 1) break; }
    }
    if (best < 0) return a;
    for (let v = 1; v <= n; v++) {
      if (!(bestMask & (1 << v))) continue;
      const next = a.slice();
      next[best] = v;
      const got = search(next);
      if (got) return got;
    }
    return null;
  }

  const got = search(assign);
  if (!got) throw new Error("无解（行/列/区域约束矛盾）");
  return { n, solution: got };
}

const opSudokuRegions = runOp(
  "e3-sudoku-regions", CAT_GAME,
  "任意区域数独（Sudoku 5×5 / 7×7 / NxN Irrégulier）",
  "先给阶数 n 与 n 行区域图（每格一个区域字符），=== 后给 n 行提示（1..9 / A..G / . _ ?）。每行、每列、每个区域都不重复。覆盖 dCode 的 Sudoku 5×5、7×7、NxN Irrégulier 等非标准宫格变体",
  (t) => {
    const { n, reg, givens } = parseSudokuRegions(t);
    const { solution } = solveRegionSudoku(n, reg, givens);
    const rows = [];
    for (let r = 0; r < n; r++) {
      const row = [];
      for (let c = 0; c < n; c++) row.push(sudokuValToChar(solution[r * n + c]));
      rows.push(row.join(" "));
    }
    return `区域数独 ${n}×${n} 解：\n${rows.join("\n")}\n校验：每行/列/区域均为 1..${n} 的排列`;
  }
);

// =====================================================================================
// 4. 列移位密钥恢复（Clé de Transposition）
// =====================================================================================
function colLengths(N, L) {
  const base = Math.floor(N / L), rem = N % L;
  return Array.from({ length: L }, (_, j) => base + (j < rem ? 1 : 0));
}

function columnarDecrypt(ct, L, order) {
  const lens = colLengths(ct.length, L);
  const cols = new Array(L);
  let pos = 0;
  for (const j of order) { cols[j] = ct.slice(pos, pos + lens[j]); pos += lens[j]; }
  let out = "";
  const rows = Math.max(...lens);
  for (let r = 0; r < rows; r++) for (let j = 0; j < L; j++) if (r < lens[j]) out += cols[j][r];
  return out;
}

const BIGRAMS = new Map(Object.entries({
  th: 100, he: 90, in: 82, er: 78, an: 75, re: 72, on: 70, at: 68, en: 66, nd: 64,
  ti: 62, es: 60, or: 58, te: 56, of: 54, ed: 52, is: 50, it: 48, al: 46, ar: 44,
  st: 42, to: 40, nt: 38, ng: 36, se: 34, ha: 32, as: 30, ou: 28, io: 26, le: 24,
  ve: 22, co: 20, me: 18, de: 16, hi: 14, ri: 12, ro: 10, ic: 8, ne: 6, ea: 4,
}));

function scoreBigrams(s) {
  let n = 0;
  for (let i = 0; i + 1 < s.length; i++) n += BIGRAMS.get(s.slice(i, i + 2).toLowerCase()) || 0;
  return n;
}

function scoreWords(s, wordSet, maxLen) {
  const N = s.length;
  const dp = new Int32Array(N + 1);
  for (let i = 0; i < N; i++) {
    if (dp[i + 1] < dp[i]) dp[i + 1] = dp[i];
    for (let len = 2; len <= maxLen && i + len <= N; len++) {
      if (wordSet.has(s.slice(i, i + len).toLowerCase())) {
        const v = dp[i] + len;
        if (v > dp[i + len]) dp[i + len] = v;
      }
    }
  }
  return dp[N];
}

const opKeyRecover = runOp(
  "e3-keyrecover", CAT_TEXT,
  "列移位密钥恢复（Clé de Transposition）",
  "密文按列读出；枚举密钥长度 2..8 的所有列顺序，用 crib（已知明文片段）或自带词表/双字母频率评分恢复明文与列序。纯换位、无网络；长度!超过 200000 时显式报错",
  (t, p) => {
    const { main, tail } = splitDoc(t);
    const ct = main.toUpperCase().replace(/[^A-Z]/g, "");
    if (ct.length < 4) throw new Error("密文至少 4 个字母");
    if (ct.length > 240) throw new Error("密文长度需 ≤240（防枚举爆炸）");
    const crib = String((p && p.crib) || "").toUpperCase().replace(/[^A-Z]/g, "");
    const maxlen = Math.max(2, Math.min(8, Number((p && p.maxlen) || 8) || 8));
    const words = tail ? parseList(tail).map((w) => w.toLowerCase().replace(/[^a-z]/g, "")).filter((w) => w.length >= 2) : [];
    const wordSet = words.length ? new Set(words) : null;
    const maxWordLen = words.length ? Math.max(...words.map((w) => w.length)) : 0;
    let best = null;
    const started = Date.now();
    let tried = 0;
    for (let L = 2; L <= Math.min(maxlen, ct.length); L++) {
      const perms = permutations(L);
      if (perms.length > 200000) throw new Error(`列数 ${L} 的排列数 ${perms.length} 超过 200000`);
      for (const order of perms) {
        if (++tried % 5000 === 0 && Date.now() - started > 15000) throw new Error("密钥恢复超 15 秒，请减小 maxlen 或加 crib");
        const pt = columnarDecrypt(ct, L, order);
        const cribHit = crib ? pt.includes(crib) : false;
        const wordScore = wordSet ? scoreWords(pt, wordSet, maxWordLen) : 0;
        let score = wordScore * 100 + scoreBigrams(pt);
        if (cribHit) score += 1000000 + crib.length * 1000;
        if (!best || score > best.score) best = { L, order, pt, score, cribHit };
      }
    }
    if (!best) throw new Error("没有找到任何候选");
    const orderStr = best.order.join(" ");
    const detail = best.cribHit
      ? `命中 crib「${crib}」`
      : crib
        ? `未命中 crib「${crib}」；退回${wordSet ? "词表覆盖" : "双字母频率"}评分 ${best.score}`
        : wordSet
          ? `词表覆盖评分 ${best.score}`
          : `双字母频率评分 ${best.score}`;
    return `密文 ${ct.length} 字母；最佳列数 ${best.L}，列读取顺序 [${orderStr}]\n${detail}\n明文：${best.pt}\n（列序从 0 起；任何同字母序的密钥词都给出同一顺序）`;
  },
  [P("crib", "已知明文片段（可选）", "WORLD"), P("maxlen", "最大密钥长度 2..8", "8")]
);

// =====================================================================================
// 5. MRZ / 身份证件（EU ID / French ID）
// =====================================================================================
const MRZ_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ<";
function mrzVal(ch) { if (ch === "<") return 0; return MRZ_CHARS.indexOf(ch); }
function mrzCheck(s) {
  let sum = 0;
  for (let i = 0; i < s.length; i++) {
    const v = mrzVal(s[i]);
    if (v < 0) return -1;
    sum += v * [7, 3, 1][i % 3];
  }
  return sum % 10;
}
function mrzDate(s, kind) {
  const yy = Number(s.slice(0, 2)), mm = Number(s.slice(2, 4)), dd = Number(s.slice(4, 6));
  if (![yy, mm, dd].every(Number.isInteger) || mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  let year;
  const nowYY = new Date().getUTCFullYear() % 100;
  if (kind === "birth") year = yy <= nowYY ? 2000 + yy : 1900 + yy;
  else year = yy < 70 ? 2000 + yy : 1900 + yy;
  const dt = new Date(Date.UTC(year, mm - 1, dd));
  if (dt.getUTCFullYear() !== year || dt.getUTCMonth() !== mm - 1 || dt.getUTCDate() !== dd) return null;
  return `${year}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
}
function mrzName(s) {
  const parts = s.replace(/<+$/, "").split("<<");
  const clean = (x) => x.replace(/</g, " ").trim();
  return { surname: clean(parts[0] || ""), given: clean(parts.slice(1).join(" ")) };
}
function mrzSex(ch) {
  if (ch === "M") return "M（男）";
  if (ch === "F") return "F（女）";
  return "<（未指定）";
}
function parseMrz(text) {
  let ls = linesOf(text).map((l) => l.toUpperCase().replace(/\s+/g, ""));
  if (ls.length === 1) {
    const s = ls[0];
    if (s.length === 90) ls = [s.slice(0, 30), s.slice(30, 60), s.slice(60, 90)];
    else if (s.length === 72) ls = [s.slice(0, 36), s.slice(36, 72)];
    else if (s.length === 88) ls = [s.slice(0, 44), s.slice(44, 88)];
  }
  if (!ls.length) throw new Error("需要 2 或 3 行 MRZ");
  for (const l of ls) if (!/^[A-Z0-9<]+$/.test(l)) throw new Error("MRZ 只允许 A-Z、0-9、<");
  const lens = ls.map((l) => l.length);
  let kind;
  if (ls.length === 3 && lens.every((x) => x === 30)) kind = "TD1";
  else if (ls.length === 2 && lens.every((x) => x === 36)) kind = "TD2";
  else if (ls.length === 2 && lens.every((x) => x === 44)) kind = "TD3";
  else throw new Error(`无法识别 MRZ 版式（行长 ${lens.join("/")}）；支持 TD1 3×30、TD2 2×36、TD3 2×44`);
  const checks = [];
  let fields;
  if (kind === "TD1") {
    const [l1, l2, l3] = ls;
    const docNum = l1.slice(5, 14), docCheck = l1[14];
    const dob = l2.slice(0, 6), dobCheck = l2[6];
    const exp = l2.slice(8, 14), expCheck = l2[14];
    const nat = l2.slice(15, 18), opt1 = l2.slice(18, 29);
    const names = mrzName(l3);
    checks.push(["证件号", docCheck, mrzCheck(docNum)]);
    checks.push(["出生日期", dobCheck, mrzCheck(dob)]);
    checks.push(["有效期", expCheck, mrzCheck(exp)]);
    const comp = l2[29];
    const compCalc = mrzCheck(l1.slice(5, 30) + l2.slice(0, 7) + l2.slice(8, 15) + l2.slice(18, 29));
    checks.push(["复合校验位", comp, compCalc]);
    fields = { docType: l1.slice(0, 2), state: l1.slice(2, 5), docNum, nat, dob, exp, sex: l2[7], names, personal: "", opt: l1.slice(15, 30) + opt1 };
  } else if (kind === "TD2") {
    const [l1, l2] = ls;
    const docNum = l2.slice(0, 9), docCheck = l2[9];
    const nat = l2.slice(10, 13);
    const dob = l2.slice(13, 19), dobCheck = l2[19];
    const exp = l2.slice(21, 27), expCheck = l2[27];
    const names = mrzName(l1.slice(5, 36));
    checks.push(["证件号", docCheck, mrzCheck(docNum)]);
    checks.push(["出生日期", dobCheck, mrzCheck(dob)]);
    checks.push(["有效期", expCheck, mrzCheck(exp)]);
    const comp = l2[35];
    const compCalc = mrzCheck(l2.slice(0, 10) + l2.slice(13, 20) + l2.slice(21, 28) + l2.slice(28, 35));
    checks.push(["复合校验位", comp, compCalc]);
    fields = { docType: l1.slice(0, 2), state: l1.slice(2, 5), docNum, nat, dob, exp, sex: l2[20], names, personal: "", opt: l2.slice(28, 35) };
  } else {
    const [l1, l2] = ls;
    const docNum = l2.slice(0, 9), docCheck = l2[9];
    const nat = l2.slice(10, 13);
    const dob = l2.slice(13, 19), dobCheck = l2[19];
    const exp = l2.slice(21, 27), expCheck = l2[27];
    const personal = l2.slice(28, 42), personalCheck = l2[42];
    const names = mrzName(l1.slice(5, 44));
    checks.push(["证件号", docCheck, mrzCheck(docNum)]);
    checks.push(["出生日期", dobCheck, mrzCheck(dob)]);
    checks.push(["有效期", expCheck, mrzCheck(exp)]);
    checks.push(["个人号", personalCheck, mrzCheck(personal)]);
    const comp = l2[43];
    const compCalc = mrzCheck(l2.slice(0, 10) + l2.slice(13, 20) + l2.slice(21, 28) + l2.slice(28, 43));
    checks.push(["复合校验位", comp, compCalc]);
    fields = { docType: l1.slice(0, 2), state: l1.slice(2, 5), docNum, nat, dob, exp, sex: l2[20], names, personal: personal.replace(/<+$/, ""), opt: "" };
  }
  const bad = checks.filter(([, got, want]) => got !== String(want));
  const dobStr = mrzDate(fields.dob, "birth") || fields.dob;
  const expStr = mrzDate(fields.exp, "expiry") || fields.exp;
  const checkLines = checks.map(([name, got, want]) => `${name}：${got} ${got === String(want) ? "✓" : `✗（应为 ${want}）`}`).join("\n");
  return `MRZ 版式：${kind}（${kind === "TD1" ? "3×30 身份证" : kind === "TD2" ? "2×36 身份证" : "2×44 护照"}）
证件类型：${fields.docType}
签发/国家：${fields.state} / ${fields.nat}
姓名：${fields.names.surname || "（空）"}${fields.names.given ? ", " + fields.names.given : ""}
证件号：${fields.docNum}
出生日期：${dobStr}
性别：${mrzSex(fields.sex)}
有效期至：${expStr}
${fields.personal ? `个人号：${fields.personal}\n` : ""}${checkLines}
校验：${bad.length ? "失败（" + bad.map(([n]) => n).join("、") + "）" : "全部通过"}`;
}

const opMrz = runOp(
  "e3-mrz", CAT_TEXT,
  "MRZ 身份证/护照解析（Carte d'Identité EU / FR）",
  "解析 TD1（3×30 身份证）、TD2（2×36）、TD3（2×44 护照）机读区：证件号、姓名、国籍、出生/有效期、性别、个人号与各校验位/复合校验位。覆盖欧盟/法国身份证的 MRZ 核心；不解析各国卡面版式或芯片数据",
  (t) => parseMrz(t)
);

// =====================================================================================
// 6. 扫雷 / Picture Sweep
// =====================================================================================
function parseMineGrid(main) {
  const rows = compactRows(main).map((r) => r.split(""));
  if (rows.length < 2 || rows.length > 24) throw new Error("扫雷网格需 2..24 行");
  const C = rows[0] ? rows[0].length : 0;
  if (C < 2 || C > 24 || !rows.every((r) => r.length === C)) throw new Error("扫雷网格需行列一致，列数 2..24");
  if (rows.length * C > 400) throw new Error("扫雷网格总格数需 ≤400");
  return rows;
}

function mineNeighbors(R, C, r, c) {
  const out = [];
  for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
    if (!dr && !dc) continue;
    const nr = r + dr, nc = c + dc;
    if (nr >= 0 && nc >= 0 && nr < R && nc < C) out.push(nr * C + nc);
  }
  return out;
}

function mineDeduce(rows) {
  const R = rows.length, C = rows[0].length;
  const mine = new Uint8Array(R * C), safe = new Uint8Array(R * C), blocked = new Uint8Array(R * C);
  const clues = [];
  for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
    const ch = rows[r][c], idx = r * C + c;
    if (/[0-8]/.test(ch)) { clues.push({ idx, r, c, n: Number(ch) }); safe[idx] = 1; }
    else if (/[*Ff]/.test(ch)) mine[idx] = 1;
    else if (/[#Xx]/.test(ch)) blocked[idx] = 1;
  }
  if (!clues.length) throw new Error("至少需要一个数字线索");
  let changed = true;
  while (changed) {
    changed = false;
    for (const cl of clues) {
      let m = 0; const unk = [];
      for (const idx of mineNeighbors(R, C, cl.r, cl.c)) {
        if (blocked[idx]) continue;
        if (mine[idx]) m++;
        else if (!safe[idx]) unk.push(idx);
      }
      if (m > cl.n) throw new Error(`线索 (${cl.r + 1},${cl.c + 1}) 周围地雷数 ${m} 已超过 ${cl.n}`);
      if (m === cl.n) {
        for (const idx of unk) if (!safe[idx]) { safe[idx] = 1; changed = true; }
      } else if (m + unk.length === cl.n) {
        for (const idx of unk) if (!mine[idx]) { mine[idx] = 1; changed = true; }
      }
    }
  }
  return { R, C, mine, safe, blocked, clues };
}

function mineSolve(rows) {
  const R = rows.length, C = rows[0].length, N = R * C;
  const fixed = new Int8Array(N).fill(-1);
  const blocked = new Uint8Array(N);
  const clues = [];
  for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
    const ch = rows[r][c], idx = r * C + c;
    if (/[0-8]/.test(ch)) { clues.push({ idx, r, c, n: Number(ch) }); fixed[idx] = 0; }
    else if (/[*Ff]/.test(ch)) fixed[idx] = 1;
    else if (/[#Xx]/.test(ch)) blocked[idx] = 1;
  }
  if (!clues.length) throw new Error("至少需要一个数字线索");
  const cons = clues.map((cl) => ({ cells: mineNeighbors(R, C, cl.r, cl.c).filter((i) => !blocked[i]), target: cl.n, r: cl.r, c: cl.c }));
  const consByVar = Array.from({ length: N }, () => []);
  cons.forEach((con, ci) => { for (const idx of con.cells) consByVar[idx].push(ci); });
  const assign = new Int8Array(N).fill(-1);
  for (let i = 0; i < N; i++) if (fixed[i] >= 0) assign[i] = fixed[i];

  function setVal(a, trail, idx, v) {
    if (a[idx] === v) return true;
    if (a[idx] >= 0) return false;
    a[idx] = v; trail.push(idx); return true;
  }
  function undo(a, trail) { for (let i = trail.length - 1; i >= 0; i--) a[trail[i]] = -1; }
  function propagate(a, trail) {
    let changed = true;
    while (changed) {
      changed = false;
      for (const con of cons) {
        let m = 0; const unk = [];
        for (const idx of con.cells) {
          const v = a[idx];
          if (v < 0) unk.push(idx); else m += v;
        }
        if (m > con.target || m + unk.length < con.target) return false;
        if (!unk.length) { if (m !== con.target) return false; continue; }
        if (m === con.target) { for (const idx of unk) if (!setVal(a, trail, idx, 0)) return false; changed = true; }
        else if (m + unk.length === con.target) { for (const idx of unk) if (!setVal(a, trail, idx, 1)) return false; changed = true; }
      }
    }
    return true;
  }

  let nodes = 0, solutions = 0, first = null;
  function search(a) {
    if (++nodes > 1000000) throw new Error("扫雷搜索超 1e6 节点，请缩小网格");
    const trail = [];
    if (!propagate(a, trail)) { undo(a, trail); return; }
    let best = -1, bestScore = -1;
    for (let i = 0; i < N; i++) {
      if (a[i] < 0 && !blocked[i] && consByVar[i].length > bestScore) { best = i; bestScore = consByVar[i].length; }
    }
    if (best < 0) {
      solutions++;
      if (!first) first = a.slice();
      undo(a, trail);
      return;
    }
    if (bestScore === 0) {
      for (let i = 0; i < N; i++) if (a[i] < 0 && !blocked[i]) a[i] = 0;
      solutions++;
      if (!first) first = a.slice();
      undo(a, trail);
      return;
    }
    for (const v of [0, 1]) {
      const t = [];
      if (setVal(a, t, best, v)) search(a);
      undo(a, t);
      if (solutions >= 2) break;
    }
    undo(a, trail);
  }
  search(assign);
  if (!first) throw new Error("无解（数字线索矛盾）");
  return { R, C, solution: first, blocked, solutions: Math.min(solutions, 2) };
}

const opMinesweeper = runOp(
  "e3-minesweeper", CAT_GAME,
  "扫雷 / Picture Sweep 求解",
  "数字=周围 8 格地雷数。deduce 只做单格约束传播（安全/雷格）；solve 回溯求一个一致布雷并判断是否多解。输入每行数字 0-8 / ? 未知 / * F 已插旗 / # 墙。覆盖 Picture Sweep、Minesweeper 的数字线索核心",
  (t, p) => {
    const { main } = splitDoc(t);
    const rows = parseMineGrid(main);
    const mode = String((p && p.mode) || "deduce");
    if (mode === "solve") {
      const { R, C, solution, blocked, solutions } = mineSolve(rows);
      const out = [];
      for (let r = 0; r < R; r++) {
        let line = "";
        for (let c = 0; c < C; c++) {
          const idx = r * C + c;
          if (blocked[idx]) line += "#";
          else if (/[0-8]/.test(rows[r][c])) line += rows[r][c];
          else line += solution[idx] === 1 ? "*" : ".";
        }
        out.push(line);
      }
      return `扫雷 ${R}×${C} ${solutions === 1 ? "唯一解" : "多解（≥2，仅列一个）"}：\n${out.join("\n")}`;
    }
    const { R, C, mine, safe, blocked, clues } = mineDeduce(rows);
    const safeList = [], mineList = [];
    for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
      const idx = r * C + c;
      if (blocked[idx]) continue;
      if (safe[idx] && !mine[idx] && !/[0-8]/.test(rows[r][c])) safeList.push(`(${r + 1},${c + 1})`);
      if (mine[idx] && !/[*Ff]/.test(rows[r][c])) mineList.push(`(${r + 1},${c + 1})`);
    }
    return `扫雷 ${R}×${C} 单格推演（线索 ${clues.length} 条）：\n安全格 ${safeList.length}：${safeList.join(" ") || "（无）"}\n雷格 ${mineList.length}：${mineList.join(" ") || "（无）"}${!safeList.length && !mineList.length ? "\n无法仅靠单格约束继续，请用 solve 模式或补充线索" : ""}`;
  },
  [SEL("mode", "模式", "deduce", [{ value: "deduce", label: "单格约束推演" }, { value: "solve", label: "回溯求一个布雷" }])]
);

// =====================================================================================
// 7. 六边形词盘（AlphaBetty / Alphamo）
// =====================================================================================
function hexRows(main) {
  const rows = linesOf(main).map((l) => l.replace(/[^A-Za-zÀ-ÿ]/g, "").toUpperCase());
  if (rows.length < 2 || rows.length > 12) throw new Error("六边形词盘需 2..12 行");
  const C = rows[0] ? rows[0].length : 0;
  if (C < 2 || C > 12 || !rows.every((r) => r.length === C)) throw new Error("每行字母数需一致（2..12）");
  if (rows.length * C > 144) throw new Error("词盘总格数需 ≤144");
  return rows;
}

function hexNeighbors(R, C, r, c) {
  const out = [];
  const push = (nr, nc) => { if (nr >= 0 && nc >= 0 && nr < R && nc < C) out.push(nr * C + nc); };
  push(r, c - 1); push(r, c + 1);
  if (r % 2 === 0) {
    push(r - 1, c - 1); push(r - 1, c);
    push(r + 1, c - 1); push(r + 1, c);
  } else {
    push(r - 1, c); push(r - 1, c + 1);
    push(r + 1, c); push(r + 1, c + 1);
  }
  return out;
}

const opHexword = runOp(
  "e3-hexword", CAT_GAME,
  "六边形词盘搜词（AlphaBetty / Alphamo）",
  "六边形网格上沿 6 邻接、不可重复用格搜词；词表由 === 后提供（每行一词，不内置私有答案库）。偶数行不偏移、奇数行右移半格的平顶布局。覆盖 AlphaBetty、Alphamo 等六边形词盘的路径核心",
  (t, p) => {
    const { main, tail } = splitDoc(t);
    const rows = hexRows(main);
    const words = requireWords(tail, "六边形词盘");
    const min = Math.max(2, Math.min(6, Number((p && p.min) || 2) || 2));
    const R = rows.length, C = rows[0].length;
    const trie = new Map();
    for (const w of words) {
      if (!/^[a-zà-ÿ]+$/.test(w) || w.length < min || w.length > R * C) continue;
      let node = trie;
      for (const ch of w) {
        const up = ch.toUpperCase();
        if (!node.has(up)) node.set(up, new Map());
        node = node.get(up);
      }
      node.set("$", w);
    }
    const found = new Map();
    const used = new Uint8Array(R * C);
    let nodes = 0;
    function rec(r, c, node, path) {
      const ch = rows[r][c];
      const next = node.get(ch);
      if (!next) return;
      if (++nodes > 2000000) throw new Error("六边形路径搜索超 2e6 节点，请缩小词盘或词表");
      const idx = r * C + c;
      used[idx] = 1;
      path.push(`(${r + 1},${c + 1})`);
      if (next.has("$")) found.set(next.get("$"), path.join("→"));
      for (const nidx of hexNeighbors(R, C, r, c)) {
        if (used[nidx]) continue;
        rec(Math.floor(nidx / C), nidx % C, next, path);
      }
      path.pop();
      used[idx] = 0;
    }
    for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) rec(r, c, trie, []);
    const out = [...found.entries()].sort((a, b) => b[0].length - a[0].length || a[0].localeCompare(b[0]));
    return `六边形词盘 ${R}×${C} 找到 ${out.length} 词（词表 ${words.length}）：\n` + (out.length ? out.map(([w, path]) => `${w} (${w.length})\t${path}`).join("\n") : "（无）");
  },
  [P("min", "最短词长 2..6", "2")]
);

// =====================================================================================
// 8. 填字/交叉网格填充（Mots-Croisés / Codycross）
// =====================================================================================
function parseCrosswordGrid(main) {
  const rows = compactRows(main).map((r) => r.split(""));
  if (rows.length < 2 || rows.length > 20) throw new Error("填字网格需 2..20 行");
  const C = rows[0] ? rows[0].length : 0;
  if (C < 2 || C > 20 || !rows.every((r) => r.length === C)) throw new Error("填字网格需行列一致，列数 2..20");
  if (rows.length * C > 400) throw new Error("填字网格总格数需 ≤400");
  for (const row of rows) for (const ch of row) {
    if (ch !== "#" && ch !== "." && !/^[A-Za-z]$/.test(ch)) throw new Error(`未知格子「${ch}」（用 # 墙、. 空、字母提示）`);
  }
  return rows;
}

function crosswordSlots(rows) {
  const R = rows.length, C = rows[0].length;
  const slots = [];
  for (let r = 0; r < R; r++) {
    let start = -1;
    for (let c = 0; c <= C; c++) {
      const open = c < C && rows[r][c] !== "#";
      if (open && start < 0) start = c;
      if ((!open || c === C) && start >= 0) {
        const len = c - start;
        if (len >= 2) {
          const cells = [];
          for (let k = start; k < c; k++) cells.push(r * C + k);
          slots.push({ dir: "横", cells, row: r + 1, col: start + 1, len });
        }
        start = -1;
      }
    }
  }
  for (let c = 0; c < C; c++) {
    let start = -1;
    for (let r = 0; r <= R; r++) {
      const open = r < R && rows[r][c] !== "#";
      if (open && start < 0) start = r;
      if ((!open || r === R) && start >= 0) {
        const len = r - start;
        if (len >= 2) {
          const cells = [];
          for (let k = start; k < r; k++) cells.push(k * C + c);
          slots.push({ dir: "竖", cells, row: start + 1, col: c + 1, len });
        }
        start = -1;
      }
    }
  }
  return slots;
}

const opCrossword = runOp(
  "e3-crossword", CAT_GAME,
  "填字网格填充（Mots-Croisés / Codycross）",
  "按网格（# 墙、. 空、字母提示）切出横向/纵向词槽，用 === 后的候选词表回溯填满；默认每词只用一次。覆盖填字/Codycross 的网格-词表核心；不内置线索答案库，线索需用户自行转成候选词",
  (t, p) => {
    const { main, tail } = splitDoc(t);
    const rows = parseCrosswordGrid(main);
    const words = requireWords(tail, "填字网格");
    const allowReuse = String((p && p.reuse) || "no") === "yes";
    const R = rows.length, C = rows[0].length;
    const slots = crosswordSlots(rows);
    if (!slots.length) throw new Error("网格中没有长度 ≥2 的词槽");
    const grid = rows.map((row) => row.map((ch) => (ch === "#" ? "#" : /^[A-Za-z]$/.test(ch) ? ch.toUpperCase() : ".")));
    const candidates = slots.map((slot) => {
      const pat = slot.cells.map((idx) => grid[Math.floor(idx / C)][idx % C]);
      return words.filter((w) => w.length === slot.len && [...w].every((ch, i) => pat[i] === "." || pat[i] === ch.toUpperCase()));
    });
    if (candidates.some((c) => !c.length)) return "无解：至少一个词槽没有匹配长度的候选词";
    let nodes = 0;
    function search() {
      if (++nodes > 2000000) throw new Error("填字搜索超 2e6 节点，请缩小网格或词表");
      const usedNow = new Set();
      for (let i = 0; i < slots.length; i++) {
        const slot = slots[i];
        const pattern = slot.cells.map((idx) => grid[Math.floor(idx / C)][idx % C]).join("");
        if (pattern.includes(".")) continue;
        const w = pattern.toLowerCase();
        if (!candidates[i].includes(w)) return false;
        if (!allowReuse && usedNow.has(w)) return false;
        usedNow.add(w);
      }
      let best = -1, bestCount = Infinity;
      for (let i = 0; i < slots.length; i++) {
        const slot = slots[i];
        const pattern = slot.cells.map((idx) => grid[Math.floor(idx / C)][idx % C]).join("");
        if (!pattern.includes(".")) continue;
        let count = 0;
        for (const w of candidates[i]) {
          if (!allowReuse && usedNow.has(w)) continue;
          let ok = true;
          for (let k = 0; k < slot.cells.length; k++) {
            const idx = slot.cells[k];
            const cur = grid[Math.floor(idx / C)][idx % C];
            if (cur !== "." && cur !== w[k].toUpperCase()) { ok = false; break; }
          }
          if (ok) count++;
        }
        if (count === 0) return false;
        if (count < bestCount) { best = i; bestCount = count; if (count === 1) break; }
      }
      if (best < 0) return true;
      const slot = slots[best];
      for (const w of candidates[best]) {
        if (!allowReuse && usedNow.has(w)) continue;
        const changed = [];
        let ok = true;
        for (let k = 0; k < slot.cells.length; k++) {
          const idx = slot.cells[k], r = Math.floor(idx / C), c = idx % C;
          const cur = grid[r][c];
          if (cur !== "." && cur !== w[k].toUpperCase()) { ok = false; break; }
          if (cur === ".") { changed.push([r, c]); grid[r][c] = w[k].toUpperCase(); }
        }
        if (ok && search()) return true;
        for (const [r, c] of changed) grid[r][c] = ".";
      }
      return false;
    }
    if (!search()) return "无解：候选词表无法同时满足所有交叉";
    const out = grid.map((row) => row.join(""));
    const list = slots.map((s) => `${s.dir} (${s.row},${s.col}) ${s.len} 格`).join("\n");
    return `填字 ${R}×${C} 解：\n${out.join("\n")}\n词槽：\n${list}`;
  },
  [SEL("reuse", "是否允许重复用词", "no", [{ value: "no", label: "每词一次" }, { value: "yes", label: "允许重复" }])]
);

// =====================================================================================
// 9. Kakuro 整盘求解
// =====================================================================================
const KAKURO_COMBOS = Array.from({ length: 10 }, () => Array.from({ length: 46 }, () => []));
for (let mask = 0; mask < 512; mask++) {
  let k = 0, sum = 0;
  for (let v = 1; v <= 9; v++) if (mask & (1 << v)) { k++; sum += v; }
  KAKURO_COMBOS[k][sum].push(mask);
}

function parseKakuro(main) {
  const rows = linesOf(main).map((l) => l.split(/\s+/));
  if (rows.length < 3) throw new Error("Kakuro 至少 3 行");
  const C = rows[0].length;
  if (C < 3 || !rows.every((r) => r.length === C)) throw new Error("每行 token 数需一致且 ≥3");
  const isWhite = [], clues = [];
  for (let r = 0; r < rows.length; r++) {
    isWhite.push([]);
    for (let c = 0; c < C; c++) {
      const tok = rows[r][c];
      if (tok === ".") { isWhite[r].push(true); continue; }
      if (tok === "#") { isWhite[r].push(false); continue; }
      const m = tok.match(/^(?:A(\d+))?(?:D(\d+))?$/i);
      if (!m || (!m[1] && !m[2])) throw new Error(`未知 token「${tok}」（用 # . A和 D和，如 A12D3）`);
      isWhite[r].push(false);
      clues.push({ r, c, across: m[1] ? Number(m[1]) : null, down: m[2] ? Number(m[2]) : null });
    }
  }
  const R = rows.length;
  const runs = [];
  const seen = new Set();
  for (const cl of clues) {
    if (cl.across !== null) {
      const cells = [];
      for (let c = cl.c + 1; c < C && isWhite[cl.r][c]; c++) cells.push(cl.r * C + c);
      if (!cells.length) throw new Error(`A 线索 (${cl.r + 1},${cl.c + 1}) 右侧没有白格`);
      const key = `A${cl.r},${cl.c}`;
      if (!seen.has(key)) { seen.add(key); runs.push({ dir: "A", cells, sum: cl.across, r: cl.r, c: cl.c }); }
    }
    if (cl.down !== null) {
      const cells = [];
      for (let r = cl.r + 1; r < R && isWhite[r][cl.c]; r++) cells.push(r * C + cl.c);
      if (!cells.length) throw new Error(`D 线索 (${cl.r + 1},${cl.c + 1}) 下方没有白格`);
      const key = `D${cl.r},${cl.c}`;
      if (!seen.has(key)) { seen.add(key); runs.push({ dir: "D", cells, sum: cl.down, r: cl.r, c: cl.c }); }
    }
  }
  const whiteIdx = new Map();
  let next = 0;
  for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) if (isWhite[r][c]) whiteIdx.set(r * C + c, next++);
  for (const run of runs) {
    if (run.cells.length > 9) throw new Error(`Kakuro 词槽长度需 ≤9（${run.dir} ${run.r + 1},${run.c + 1}）`);
    const min = run.cells.length * (run.cells.length + 1) / 2;
    const max = (9 + 10 - run.cells.length) * run.cells.length / 2;
    if (run.sum < min || run.sum > max) throw new Error(`Kakuro 和 ${run.sum} 超出 ${run.cells.length} 格的范围 ${min}..${max}`);
    run.vars = run.cells.map((idx) => whiteIdx.get(idx));
  }
  const covered = new Set();
  for (const run of runs) for (const v of run.vars) covered.add(v);
  if (covered.size !== whiteIdx.size) throw new Error("存在未被任何线索覆盖的白格");
  const cellRuns = Array.from({ length: whiteIdx.size }, () => []);
  runs.forEach((run, ri) => { for (const v of run.vars) cellRuns[v].push(ri); });
  return { R, C, rows, isWhite, runs, cellRuns, count: whiteIdx.size, whiteIdx };
}

function solveKakuro(parsed) {
  const { runs, cellRuns, count } = parsed;
  const assign = new Int8Array(count).fill(-1);
  function runState(run) {
    let sum = 0, used = 0; const un = [];
    for (const v of run.vars) {
      const x = assign[v];
      if (x < 0) un.push(v); else { sum += x; used |= 1 << x; }
    }
    const remaining = run.sum - sum;
    if (remaining < 0) return null;
    const k = un.length;
    const combos = KAKURO_COMBOS[k][remaining];
    if (!combos || !combos.some((mask) => (mask & used) === 0)) return null;
    return { sum, used, un, remaining, k };
  }
  function feasible() {
    for (const run of runs) if (!runState(run)) return false;
    return true;
  }
  function allowed(v) {
    let mask = 0;
    for (let x = 1; x <= 9; x++) {
      assign[v] = x;
      let ok = true;
      for (const ri of cellRuns[v]) if (!runState(runs[ri])) { ok = false; break; }
      assign[v] = -1;
      if (ok) mask |= 1 << x;
    }
    return mask;
  }
  let nodes = 0;
  function search() {
    if (++nodes > 2000000) throw new Error("Kakuro 搜索超 2e6 节点，请增加线索或缩小网格");
    if (!feasible()) return false;
    let best = -1, bestMask = 0, bestCount = 99;
    for (let v = 0; v < count; v++) {
      if (assign[v] >= 0) continue;
      const mask = allowed(v);
      const cnt = popcount(mask);
      if (cnt === 0) return false;
      if (cnt < bestCount) { best = v; bestMask = mask; bestCount = cnt; if (cnt === 1) break; }
    }
    if (best < 0) return true;
    for (let x = 1; x <= 9; x++) {
      if (!(bestMask & (1 << x))) continue;
      assign[best] = x;
      if (search()) return true;
      assign[best] = -1;
    }
    return false;
  }
  if (!search()) throw new Error("无解（Kakuro 线索矛盾）");
  return assign;
}

const opKakuro = runOp(
  "e3-kakuro", CAT_NUM,
  "Kakuro 整盘求解（Kakuro / Cross Sums）",
  "网格 token：# 墙、. 白格、A数字=横向和、D数字=纵向和、A12D3=同时有横纵线索。每段填 1..9 不重复且和等于线索；回溯+组合可行性剪枝。补齐 D3 仅做组合枚举的缺口",
  (t) => {
    const { main } = splitDoc(t);
    const parsed = parseKakuro(main);
    const assign = solveKakuro(parsed);
    const out = [];
    for (let r = 0; r < parsed.R; r++) {
      const row = [];
      for (let c = 0; c < parsed.C; c++) {
        if (!parsed.isWhite[r][c]) { row.push(parsed.rows[r][c]); continue; }
        row.push(String(assign[parsed.whiteIdx.get(r * parsed.C + c)]));
      }
      out.push(row.join(" "));
    }
    return `Kakuro ${parsed.R}×${parsed.C} 解：\n${out.join("\n")}\n词槽 ${parsed.runs.length} 段，全部满足和与不重复约束`;
  }
);

// =====================================================================================
// 10. 吉他和弦指板（Notation des Accords de Guitare）
// =====================================================================================
const NOTE_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const SHARP_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const FLAT_NAMES = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
const CHORD_QUALITIES = [
  [/^(?:maj|M)?$/, [0, 4, 7]],
  [/^(?:m|min|-)$/, [0, 3, 7]],
  [/^(?:7|dom7)$/, [0, 4, 7, 10]],
  [/^(?:maj7|M7|Δ7)$/, [0, 4, 7, 11]],
  [/^(?:m7|min7|-7)$/, [0, 3, 7, 10]],
  [/^(?:dim|o|°)$/, [0, 3, 6]],
  [/^(?:dim7|o7|°7)$/, [0, 3, 6, 9]],
  [/^(?:aug|\+)$/, [0, 4, 8]],
  [/^sus2$/, [0, 2, 7]],
  [/^(?:sus4|sus)$/, [0, 5, 7]],
  [/^6$/, [0, 4, 7, 9]],
  [/^(?:m6|min6)$/, [0, 3, 7, 9]],
  [/^9$/, [0, 4, 7, 10, 14]],
  [/^(?:m9|min9)$/, [0, 3, 7, 10, 14]],
  [/^(?:maj9|M9)$/, [0, 4, 7, 11, 14]],
  [/^add9$/, [0, 4, 7, 14]],
  [/^7sus4$/, [0, 5, 7, 10]],
  [/^(?:m7b5|ø|ø7)$/, [0, 3, 6, 10]],
];

function parseChord(sym) {
  const m = String(sym).trim().match(/^([A-Ga-g])([#b]?)(.*)$/);
  if (!m) throw new Error(`无法解析和弦「${sym}」`);
  const root = m[1].toUpperCase();
  const accidental = m[2];
  const quality = m[3] || "";
  const found = CHORD_QUALITIES.find(([re]) => re.test(quality));
  if (!found) throw new Error(`未知和弦性质「${quality}」（支持 maj/m/7/maj7/m7/dim/aug/sus/6/9/add9/m7b5 等）`);
  const rootPc = (NOTE_PC[root] + (accidental === "#" ? 1 : accidental === "b" ? 11 : 0)) % 12;
  const names = accidental === "b" ? FLAT_NAMES : SHARP_NAMES;
  const pcs = found[1].map((i) => (rootPc + i) % 12);
  const tones = pcs.map((pc) => names[pc]);
  return { symbol: sym, root, rootPc, quality, intervals: found[1], pcs, tones };
}

function guitarVoicings(chord) {
  const tuning = [40, 45, 50, 55, 59, 64];
  const options = tuning.map((midi) => {
    const opts = [{ fret: null, pc: null }];
    for (let fret = 0; fret <= 12; fret++) {
      const pc = (midi + fret) % 12;
      if (chord.pcs.includes(pc)) opts.push({ fret, pc });
    }
    return opts;
  });
  const out = [];
  function rec(s, picks) {
    if (s === 6) {
      const sounding = picks.filter((p) => p.fret !== null);
      if (sounding.length < 3) return;
      const frets = sounding.map((p) => p.fret);
      const maxFret = Math.max(...frets), minFret = Math.min(...frets);
      if (maxFret - minFret > 4) return;
      const pcs = new Set(sounding.map((p) => p.pc));
      if (pcs.size < 3) return;
      const rootPc = chord.rootPc;
      const lowest = sounding[0].pc;
      let score = sounding.length * 10 - (maxFret - minFret) * 4;
      if (lowest === rootPc) score += 100;
      score += sounding.filter((p) => p.fret === 0).length * 3;
      score -= maxFret * 6;
      const firstSounding = picks.findIndex((p) => p.fret !== null);
      const lastSounding = picks.length - 1 - [...picks].reverse().findIndex((p) => p.fret !== null);
      let interiorMute = 0;
      for (let i = firstSounding; i <= lastSounding; i++) if (picks[i].fret === null) interiorMute++;
      score -= interiorMute * 8;
      const key = picks.map((p) => (p.fret === null ? "x" : p.fret)).join("");
      if (!out.some((x) => x.key === key)) out.push({ key, picks, score, maxFret, minFret });
      return;
    }
    for (const opt of options[s]) rec(s + 1, [...picks, opt]);
  }
  rec(0, []);
  out.sort((a, b) => b.score - a.score || a.maxFret - b.maxFret || a.key.localeCompare(b.key));
  return out.slice(0, 3);
}

function renderGuitar(chord) {
  const voicings = guitarVoicings(chord);
  if (!voicings.length) throw new Error(`无法为 ${chord.symbol} 在 0..12 品找到 3 音以上指法`);
  const labels = ["E", "A", "D", "G", "B", "e"];
  const blocks = [];
  for (const v of voicings) {
    const lines = [];
    for (let s = 0; s < 6; s++) {
      const p = v.picks[s];
      const cell = p.fret === null ? "x" : String(p.fret);
      lines.push(`${labels[s]} |--${cell.padEnd(2, "-")}-`);
    }
    const fingering = v.picks.map((p) => (p.fret === null ? "x" : p.fret)).join("");
    blocks.push(`${chord.symbol} (${chord.tones.join(" ")})  指法 ${fingering}  品位 ${v.minFret}..${v.maxFret}\n${lines.join("\n")}`);
  }
  return blocks.join("\n\n");
}

const opGuitar = runOp(
  "e3-guitar", CAT_TEXT,
  "吉他和弦指板（Notation des Accords de Guitare）",
  "解析 C / Am / G7 / F#m7b5 等和弦，按标准调弦 EADGBE 生成 0..12 品的可弹指法（含 x 闷弦）与 ASCII 指板图；最多给 3 个按跨度/根音/空弦排序的指法。纯算法，不依赖和弦图数据库",
  (t) => {
    const syms = String(t || "").split(/[\s,;]+/).filter(Boolean);
    if (!syms.length) throw new Error("给和弦名，如 C Am G7 F#m7b5");
    if (syms.length > 20) throw new Error("一次最多 20 个和弦");
    const blocks = syms.map((sym) => {
      const chord = parseChord(sym);
      return renderGuitar(chord);
    });
    return blocks.join("\n\n");
  }
);

// =====================================================================================
// 11. 文本五线谱 / ABC 记谱（Partition / Portée de Musique）
// =====================================================================================
const SOLFEGE = { do: 0, re: 2, mi: 4, fa: 5, sol: 7, la: 9, si: 11, ré: 2 };
const SOLFEGE_LETTER = { do: "C", re: "D", mi: "E", fa: "F", sol: "G", la: "A", si: "B", ré: "D" };
const ABC_PC = { 0: "C", 1: "^C", 2: "D", 3: "^D", 4: "E", 5: "F", 6: "^F", 7: "G", 8: "^G", 9: "A", 10: "^A", 11: "B" };
const DIA_STEP = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };

function parseNoteToken(tok) {
  const m = String(tok).trim().match(/^([A-Ga-g]|do|re|mi|fa|sol|la|si|ré)([#b]?)(-?\d)(?:\/(1|2|4|8|16))?$/i);
  if (!m) throw new Error(`无法解析音符「${tok}」（如 C4 / F#5 / do4 / A4/8）`);
  let letter = m[1].toLowerCase();
  let pc;
  if (SOLFEGE[letter] !== undefined) {
    pc = SOLFEGE[letter];
    letter = SOLFEGE_LETTER[letter];
  } else {
    const up = m[1].toUpperCase();
    pc = NOTE_PC[up];
    letter = up;
  }
  if (m[2] === "#") pc = (pc + 1) % 12;
  if (m[2] === "b") pc = (pc + 11) % 12;
  const octave = Number(m[3]);
  const midi = (octave + 1) * 12 + pc;
  const dur = m[4] ? Number(m[4]) : 4;
  return { token: tok, letter: letter.charAt(0).toUpperCase(), pc, octave, midi, dur };
}

function abcNote(note) {
  const base = ABC_PC[note.pc] || "C";
  if (note.octave >= 5) return base.toLowerCase() + "'".repeat(note.octave - 5);
  if (note.octave <= 3) return base + ",".repeat(4 - note.octave);
  return base;
}

function abcLength(dur) {
  if (dur === 1) return "4";
  if (dur === 2) return "2";
  if (dur === 4) return "";
  if (dur === 8) return "/2";
  if (dur === 16) return "/4";
  return "";
}

const STAFF_LINES = new Set([30, 32, 34, 36, 38]); // E4 G4 B4 D5 F5

function renderStaff(notes) {
  const steps = notes.map((n) => n.octave * 7 + DIA_STEP[n.letter]);
  const maxStep = Math.max(40, ...steps), minStep = Math.min(26, ...steps);
  const out = [];
  for (let step = maxStep; step >= minStep; step--) {
    const isLine = STAFF_LINES.has(step);
    let line = "";
    for (const n of notes) {
      const s = n.octave * 7 + DIA_STEP[n.letter];
      if (s === step) line += n.letter;
      else line += isLine ? "-" : " ";
    }
    const marker = isLine ? "=" : " ";
    out.push(`${String(step).padStart(2)} ${marker}|${line}`);
  }
  return out.join("\n");
}

const opStaff = runOp(
  "e3-staff", CAT_TEXT,
  "文本五线谱 / ABC 记谱（Partition / Portée）",
  "把 C4 D4 E4 / do re mi 等音符序列转成音名、MIDI、ABC 记谱和 ASCII 五线谱（高音谱号，E4/G4/B4/D5/F5 为线）。文本/ABC 输出，不生成图片或字体；覆盖 Partition/Portée 的文本记谱核心",
  (t) => {
    const toks = String(t || "").split(/[\s,;|]+/).filter(Boolean);
    if (!toks.length) throw new Error("给音符序列，如 C4 D4 E4 F4");
    if (toks.length > 200) throw new Error("一次最多 200 个音符");
    const notes = toks.map(parseNoteToken);
    const names = notes.map((n) => `${n.letter}${n.octave}(${n.midi})`).join(" ");
    const abc = notes.map((n) => abcNote(n) + abcLength(n.dur)).join(" ");
    return `音符：${names}
ABC：
X:1
T:Note sequence
M:4/4
L:1/4
K:C
${abc}|
ASCII 五线谱：
${renderStaff(notes)}`;
  }
);

// =====================================================================================
// 导出
// =====================================================================================
export const OPS = [
  opFillapix, opTectonic, opSudokuRegions, opKeyRecover, opMrz,
  opMinesweeper, opHexword, opCrossword, opKakuro, opGuitar, opStaff,
];

// 41 个 D3 blocked 条目逐条重新判定 + 1 个 D3 部分 mapped（Kakuro）升级。
const C = (cat, name, slug, status, opOrReason, note) => ({
  cat, name, slug, url: `https://www.dcode.fr/${slug}`, status,
  ...(status === "blocked" ? { reason: opOrReason } : { op: opOrReason }),
  ...(note ? { note } : {}),
});

export const COVERAGE = [
  C("Jeux de Société", "Solveur Fling", "solveur-fling", "blocked", "专有弹球谜题，盘面/物理规则未公开；纯文本求解会伪造结果"),
  C("Jeux sur Mobile", "Solveur AlphaBetty", "solveur-alphabetty", "implemented", "e3-hexword", "六边形路径词表核心；不内置游戏私有词库/计分"),
  C("Jeux sur Mobile", "Solveur de Codycross", "solveur-codycross", "mapped", "e3-crossword", "网格+候选词填充；不内置 Codycross 线索答案库"),
  C("Jeux de Lettres", "Alphamo", "solveur-alphamo", "implemented", "e3-hexword", "六边形路径核心；不内置专有词盘/计分"),
  C("Jeux de Lettres", "Générateur d'Autogramme", "generateur-auto-description", "blocked", "自描述句是受约束自然语言不动点问题，dCode 的生成器/语料未公开；不硬编码答案冒充生成"),
  C("Jeux de Lettres", "Harry - Le Jeu", "harry-jeu", "blocked", "专有游戏规则/棋盘未公开，无法确定性复现"),
  C("Jeux de Lettres", "Solveur Figguess", "solveur-figguess", "blocked", "图片线索语义库缺失；需要图像理解/私有图库"),
  C("Jeux de Lettres", "Solveur de Mots-Croisés", "solveur-mots-croises", "mapped", "e3-crossword", "网格+词表填充；不内置填字线索答案库"),
  C("Jeux de Lettres", "Solveur de Mots Couplés", "solveur-mots-couples", "blocked", "专有配对词游戏规则未公开"),
  C("Jeux de Lettres", "Solveur AlphaBetty", "solveur-alphabetty", "implemented", "e3-hexword", "同 Mobile 条目；六边形路径核心，词表自带"),
  C("Jeux de Lettres", "Solveur de Codycross", "solveur-codycross", "mapped", "e3-crossword", "同 Mobile 条目；网格+候选词，无线索库"),
  C("Jeux de Nombres", "Générateur d'Autogramme", "generateur-auto-description", "blocked", "自描述句生成无公开确定性算法；不伪造"),
  C("Jeux de Nombres", "Solveur Fill-A-Pix", "solveur-fill-a-pix", "implemented", "e3-fillapix", "3×3 窗口数字线索回溯；支持含/不含中心格"),
  C("Jeux de Nombres", "Solveur Picture Sweep", "solveur-picture-sweep", "mapped", "e3-minesweeper", "数字扫雷核心；不重建隐藏图片"),
  C("Jeux de Nombres", "Solveur Sudoku 5x5", "solveur-sudoku-5x5", "implemented", "e3-sudoku-regions", "用户给 5×5 区域图，支持非标准宫格"),
  C("Jeux de Nombres", "Solveur Sudoku 7x7", "solveur-sudoku-7x7", "implemented", "e3-sudoku-regions", "用户给 7×7 区域图，支持非标准宫格"),
  C("Jeux de Nombres", "Solveur Sudoku NxN Irrégulier", "solveur-sudoku-irregulier", "implemented", "e3-sudoku-regions", "任意 N×N 区域图（2..16）"),
  C("Jeux de Nombres", "Solveur Tectonic", "solveur-tectonic", "implemented", "e3-tectonic", "Suguru/Tectonic：区域唯一、8 邻域不重复、正交不连续"),
  C("Recherche de Mots", "Clé de Transposition", "cle-transposition", "implemented", "e3-keyrecover", "枚举列序 2..8，crib/词表/双字母评分"),
  C("Internet", "Enregistrements DNS", "enregistrements-dns", "blocked", "需 DNS 网络查询，违反纯前端零外发"),
  C("Télécommunication", "Géolocalisation d'un Numéro de Téléphone", "geolocalisation-numero-telephone", "blocked", "需运营商/号码段数据库或外部 API"),
  C("Fun/Divers", "Accent Allemand", "accent-allemand", "blocked", "dCode 专有谐音改写规则未公开，近似会伪造结果"),
  C("Fun/Divers", "Accent Anglais", "accent-anglais", "blocked", "dCode 专有谐音改写规则未公开"),
  C("Fun/Divers", "Accent Asiatique", "accent-asiatique", "blocked", "dCode 专有谐音改写规则未公开"),
  C("Fun/Divers", "Accent Espagnol", "accent-hispanique", "blocked", "dCode 专有谐音改写规则未公开"),
  C("Fun/Divers", "Accent Etranger", "accent-etranger", "blocked", "dCode 专有谐音改写规则未公开"),
  C("Fun/Divers", "Accent Français", "accent-francais", "blocked", "dCode 专有谐音改写规则未公开"),
  C("Fun/Divers", "Accent Italien", "accent-italien", "blocked", "dCode 专有谐音改写规则未公开"),
  C("Fun/Divers", "Accent Russe", "accent-russe", "blocked", "dCode 专有谐音改写规则未公开"),
  C("Fun/Divers", "Caractères des Alphabets Etrangers", "alphabets-caracteres-latins-etrangers", "blocked", "外语字母参考/输入表，非确定性算法"),
  C("Fun/Divers", "Carte d'Identité Européenne", "carte-identite-europenne", "implemented", "e3-mrz", "TD1/TD2/TD3 MRZ 解析与校验位；不解析卡面/芯片"),
  C("Fun/Divers", "Carte d'Identité Française", "carte-identite-francaise", "mapped", "e3-mrz", "法国身份证的 TD1 MRZ 可解析；卡号/卡面版式未覆盖"),
  C("Fun/Divers", "Chiffres Miroir", "chiffres-miroir", "mapped", "d1-mirror-digits", "既有插件 op：0↔0 1↔1 2↔5 5↔2 6↔9 8↔8 9↔6"),
  C("Fun/Divers", "Ecriture Dotsies", "ecriture-dotsies", "blocked", "Dotsies 字体映射非 Unicode 标准，缺少可核验文本表；不猜映射"),
  C("Fun/Divers", "Langage de Shankar (Slumdog Millionnaire)", "langage-shankar", "blocked", "虚构语言映射未公开"),
  C("Fun/Divers", "Rotation du Cube", "rotation-cube", "blocked", "三维魔方/立方体状态旋转的输入格式与规则未文档化"),
  C("Fun/Divers", "Séparateur de Syllabes", "separateur-syllabes", "blocked", "dCode 音节切分算法未公开；规则近似不可靠（插件另有启发式 d4-syllables，但不等同 dCode 结果）"),
  C("Musique", "Chiffre par Partition Musicale", "chiffre-partition-musicale", "blocked", "乐谱图形/音符-字母映射存在多个不兼容变体，未核实唯一表"),
  C("Musique", "Code Acéré", "chiffre-acere", "blocked", "冷门符号密码存在多个互不兼容变体，无公开唯一规范"),
  C("Musique", "Notation des Accords de Guitare", "notation-accords-guitare", "implemented", "e3-guitar", "和弦构成音 + 标准调弦 0..12 品指法/ASCII 指板；非和弦图数据库"),
  C("Musique", "Partition/Portée de Musique", "partition-musique", "mapped", "e3-staff", "文本/ABC/ASCII 五线谱；不生成图形乐谱或字体"),
  { cat: "Jeux de Nombres", name: "Solveur de Kakuro", slug: "solveur-kakuro", url: "https://www.dcode.fr/solveur-kakuro", status: "implemented", op: "e3-kakuro", note: "D3 仅映射到 game-kakuro 组合枚举；本批实现整盘回溯求解", tag: "upgrade" },
];










