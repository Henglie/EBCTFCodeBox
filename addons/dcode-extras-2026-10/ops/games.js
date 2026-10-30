/*
 * dcode-extras · 谜题求解器批（对标 dCode Jeux de Société / Jeux de Nombres 未入主件部分）
 * 数独 9×9 / 24 点 / Mastermind / 幻方 已由 dcode-puzzlesolver 插件覆盖，不重复。
 * 所有求解器有界（节点/时间预算），超限显式报错不硬算。
 */

import { runOp, parseList, shuffled } from "../lib/util.js";

const CAT = "dcode-extras-2026-10/cat-game";
const P = (key, label, ph) => ({ key, label, type: "text", default: "", placeholder: ph || "" });
const SEL = (key, label, def, opts) => ({ key, label, type: "select", default: def, options: opts.map((o) => (typeof o === "string" ? { value: o, label: o } : o)) });

// ---------- 数字华容道（Taquin） ----------
function taquinSolve(start, size, budget) {
  const n2 = size * size;
  const goal = Array.from({ length: n2 }, (_, i) => (i + 1) % n2); // 0 = 空格
  const startKey = start.join(",");
  if (startKey === goal.join(",")) return { moves: [], note: "已还原" };
  // 可解性：逆序数奇偶（宽度奇数：逆序数须为偶）
  let inv = 0;
  const tiles = start.filter((x) => x !== 0);
  for (let i = 0; i < tiles.length; i++)
    for (let j = i + 1; j < tiles.length; j++) if (tiles[i] > tiles[j]) inv++;
  if (size % 2 === 1 && inv % 2 !== 0) return { unsolvable: true };
  if (size % 2 === 0) {
    const rowFromBottom = size - Math.floor(start.indexOf(0) / size);
    if ((inv + rowFromBottom) % 2 !== 1) return { unsolvable: true };
  }
  const heur = (b) => {
    let h = 0;
    for (let i = 0; i < n2; i++) {
      const v = b[i];
      if (!v) continue;
      const gi = v - 1;
      h += Math.abs(Math.floor(i / size) - Math.floor(gi / size)) + Math.abs((i % size) - (gi % size));
    }
    return h;
  };
  // IDA*（曼哈顿距离），节点预算
  const DIRS = [-size, size, -1, 1];
  const ok = (pos, d) => d === -size ? pos >= size : d === size ? pos < n2 - size : d === -1 ? pos % size !== 0 : pos % size !== size - 1;
  let nodes = 0, path = [];
  const DFS = (b, zpos, g, bound, prev) => {
    if (++nodes > budget) throw new Error(`搜索节点超预算 ${budget}（请用更容易的盘面或加大预算）`);
    const h = heur(b);
    if (h === 0) return true;
    if (g + h > bound) return false;
    for (const d of DIRS) {
      if (!ok(zpos, d)) continue;
      if (d === -prev) continue;
      const np = zpos + d;
      b[zpos] = b[np]; b[np] = 0;
      path.push(b[zpos]);
      if (DFS(b, np, g + 1, bound, d)) return true;
      path.pop();
      b[np] = b[zpos]; b[zpos] = 0;
    }
    return false;
  };
  let bound = heur(start);
  const board = start.slice();
  const zpos0 = start.indexOf(0);
  while (bound <= 80) {
    nodes = 0; path = [];
    const b = board.slice();
    if (DFS(b, zpos0, 0, bound, 0)) return { moves: path, nodes };
    bound += 2;
  }
  throw new Error("IDA* 深度上限 80 步内未解出");
}
export const taquinOps = runOp("dcode-extras-2026-10/game-taquin", CAT, "数字华容道求解（Taquin）", "3×3 最优解 / 4×4 预算内解（IDA*+曼哈顿）。输入：按行空格分隔，0=空格，行间换行或 / 。输出移动数字序列",
  (t, p) => {
    const src = String(t).replace(/\//g, "\n").trim();
    let toks = src.split(/[\s,]+/).filter(Boolean);
    // 兼容粘连输入：9/16/25 连写数字按字符拆
    if (toks.length === 1 && /^\d+$/.test(toks[0]) && [9, 16, 25].includes(toks[0].length)) {
      toks = [...toks[0]];
    }
    const nums = toks.map(Number);
    const size = Number((p && p.size) || 0) || (nums.length === 9 ? 3 : nums.length === 16 ? 4 : nums.length === 25 ? 5 : 0);
    if (!size) throw new Error("自动识别失败：需要 9/16/25 个数字（0=空格）");
    if (!nums.every((x) => Number.isInteger(x) && x >= 0 && x < size * size) || new Set(nums).size !== nums.length) throw new Error("数字必须是 0..N²-1 的一个排列");
    const budget = Math.min(Number((p && p.budget) || 2e6) || 2e6, 2e7);
    const r = taquinSolve(nums, size, budget);
    if (r.unsolvable) return "该盘面不可解（逆序数奇偶性不符）";
    return `可解。最优/找到的移动序列（依次点击这些数字）：\n${r.moves.join(" → ") || "（已还原）"}\n共 ${r.moves.length} 步（搜索 ${r.nodes} 节点）`;
  }, [P("size", "边长（0=自动）", "0"), P("budget", "节点预算 ≤2e7", "2000000")]);

// ---------- 汉诺塔 ----------
export const hanoiOps = runOp("dcode-extras-2026-10/game-hanoi", CAT, "汉诺塔步骤（Tour de Hanoï）", "n 盘三柱移动步骤（2ⁿ−1 步），格式 A→B；起始柱/目标柱可指定",
  (t, p) => {
    const n = Number((p && p.n) || t) || 0;
    const from = String((p && p.from) || "A").toUpperCase();
    const to = String((p && p.to) || "C").toUpperCase();
    const via = ["A", "B", "C"].find((x) => x !== from && x !== to);
    if (!Number.isInteger(n) || n < 1 || n > 20) throw new Error("盘数需 1..20");
    if (!["A", "B", "C"].includes(from) || !["A", "B", "C"].includes(to) || from === to) throw new Error("柱名 A/B/C，起止不能相同");
    const moves = [];
    const rec = (k, a, b, c) => { if (k === 1) { moves.push(`${a}→${c}`); return; } rec(k - 1, a, c, b); moves.push(`${a}→${c}`); rec(k - 1, b, a, c); };
    rec(n, from, via, to);
    return `${n} 盘 ${from}→${to} 共 ${moves.length} 步（= 2^${n}−1）：\n${moves.join("\n")}`;
  }, [P("n", "盘数 ≤20", "3"), P("from", "起始柱", "A"), P("to", "目标柱", "C")]);

// ---------- Lights Out ----------
export const lightsoutOps = runOp("dcode-extras-2026-10/game-lightsout", CAT, "点灯求解（Lights Out）", "n×n 灯阵按一次翻转十字五格；GF(2) 高斯消元给需要点击的位置（解不唯一时给一个基础解系）。输入：0/1 矩阵行",
  (t, p) => {
    const rows = parseList(t).map((r) => r.replace(/[^01]/g, ""));
    const n = rows.length;
    if (n < 2 || n > 10 || !rows.every((r) => r.length === n)) throw new Error("需要 n 行 × n 列 0/1（n=2..10），每行一项");
    const N = n * n;
    const A = [];
    for (let i = 0; i < N; i++) {
      const row = new Uint8Array(N + 1);
      const r = Math.floor(i / n), c = i % n;
      row[i] ^= 1;
      if (r > 0) row[i - n] ^= 1;
      if (r < n - 1) row[i + n] ^= 1;
      if (c > 0) row[i - 1] ^= 1;
      if (c < n - 1) row[i + 1] ^= 1;
      row[N] = rows[r][c] === "1" ? 1 : 0;
      A.push(row);
    }
    // 高斯消元 GF(2)
    const pivots = [];
    let rowIdx = 0;
    for (let col = 0; col < N && rowIdx < N; col++) {
      let sel = -1;
      for (let r = rowIdx; r < N; r++) if (A[r][col]) { sel = r; break; }
      if (sel < 0) continue;
      [A[rowIdx], A[sel]] = [A[sel], A[rowIdx]];
      for (let r = 0; r < N; r++) if (r !== rowIdx && A[r][col]) for (let c2 = col; c2 <= N; c2++) A[r][c2] ^= A[rowIdx][c2];
      pivots.push(col);
      rowIdx++;
    }
    for (let r = rowIdx; r < N; r++) if (A[r][N]) return "该盘面在标准 Lights Out 规则下无解（奇偶性不符）";
    const clicks = new Array(N).fill(0);
    pivots.forEach((col, k) => { clicks[col] = A[k][N]; });
    const free = [];
    for (let i = 0; i < N; i++) if (!pivots.includes(i)) free.push(i);
    const grid = [];
    for (let r = 0; r < n; r++) grid.push(clicks.slice(r * n, r * n + n).join(""));
    return (free.length ? `解不唯一（自由变量 ${free.length} 个），以下是一个最简解：\n` : "") + grid.join("\n") + `\n共点击 ${clicks.filter(Boolean).length} 次`;
  });

// ---------- Bulls & Cows ----------
export const bullscowsOps = runOp("dcode-extras-2026-10/game-bullscows", CAT, "Bulls & Cows 候选枚举", "按历史猜测反馈（格式：猜测 :xAyB 每行一条）枚举全部一致 4 位候选；数字可重复开关",
  (t, p) => {
    const uniq = String((p && p.uniq) || "oui") === "oui";
    const lines = parseList(t);
    if (!lines.length) throw new Error("每行一条「1234 : 1A2B」");
    const hist = [];
    for (const l of lines) {
      const m = l.replace(/\s/g, "").match(/^(\d{3,6}):(\d+)A(\d+)B$/i);
      if (!m) throw new Error(`行「${l}」格式应为 1234:1A2B`);
      hist.push({ g: m[1], a: +m[2], b: +m[3] });
    }
    const L = hist[0].g.length;
    const score = (cand, g) => {
      let a = 0, b = 0;
      const cc = [...cand], gg = [...g];
      for (let i = 0; i < L; i++) if (cc[i] === gg[i]) { a++; cc[i] = gg[i] = null; }
      for (let i = 0; i < L; i++) if (cc[i] != null && gg.includes(cc[i])) { b++; gg[gg.indexOf(cc[i])] = null; }
      return [a, b];
    };
    const out = [];
    const total = uniq ? 10 * 9 * 8 * 7 : 10 ** L;
    if (total > 1e7) throw new Error("位数过长");
    if (uniq && L <= 4) {
      for (let i = 0; i < 10 ** L; i++) {
        const c = String(i).padStart(L, "0");
        if (new Set(c).size !== L) continue;
        if (hist.every((h) => { const [a, b] = score(c, h.g); return a === h.a && b === h.b; })) { out.push(c); if (out.length > 5000) throw new Error("候选超过 5000，请再加反馈"); }
      }
    } else {
      for (let i = 0; i < 10 ** L; i++) {
        const c = String(i).padStart(L, "0");
        if (hist.every((h) => { const [a, b] = score(c, h.g); return a === h.a && b === h.b; })) { out.push(c); if (out.length > 5000) throw new Error("候选超过 5000，请再加反馈"); }
      }
    }
    return `一致候选 ${out.length} 个：\n${out.join(" ")}`;
  }, [SEL("uniq", "数字不重复", "oui", [{ value: "oui", label: "不重复" }, { value: "non", label: "可重复" }])]);

// ---------- Cryptarithme（字谜算式） ----------
export const cryptarithmOps = runOp("dcode-extras-2026-10/game-cryptarithm", CAT, "Cryptarithme 字谜算式", "SEND+MORE=MONEY 类字母算式求解（不同字母=不同数字，首字母≠0；支持 + - = ；预算 5e6 节点）",
  (t) => {
    const src = String(t).replace(/\s+/g, "");
    if (!/^[A-Z+\-]*=[A-Z+\-]*$|^[A-Z+\-]+=[A-Z+\-]+$/.test(src) || !src.includes("=")) throw new Error("格式：SEND+MORE=MONEY（大写字母与 + − =）");
    const [lhs, rhs] = src.split("=");
    const terms = lhs.split(/(?=[+\-])/).map((x) => x.replace(/^[+\-]/, ""));
    const signs = [];
    for (const m of lhs.matchAll(/[+\-]/g)) signs.push(m[0] === "-" ? -1 : 1);
    const letters = [...new Set(src.replace(/[^A-Z]/g, "").split(""))];
    if (!letters.length || letters.length > 10) throw new Error("字母种类需 1..10 个");
    const val = (w, map) => { let v = 0; for (const c of w) v = v * 10 + map[c]; return v; };
    const firsts = new Set(terms.concat([rhs]).filter((w) => w.length > 1).map((w) => w[0]));
    let nodes = 0, solutions = [];
    const budget = 5e6;
    const rec = (map, used, i) => {
      if (solutions.length >= 10) return;
      if (++nodes > budget) throw new Error(`搜索节点超预算 ${budget}（字母组合过大）`);
      if (i === letters.length) {
        let sum = val(terms[0], map);
        signs.forEach((s, k) => { sum += s * val(terms[k + 1], map); });
        if (sum === val(rhs, map)) {
          solutions.push(letters.map((c) => `${c}=${map[c]}`).join(" ") + `  ⇒  ${lhs.replace(/[A-Z]+/g, (w) => String(val(w, map)))}=${val(rhs, map)}`);
        }
        return;
      }
      const L = letters[i];
      for (let d = 0; d <= 9; d++) {
        if (used[d]) continue;
        if (d === 0 && firsts.has(L)) continue;
        map[L] = d; used[d] = true;
        rec(map, used, i + 1);
        used[d] = false; delete map[L];
      }
    };
    rec({}, new Array(10).fill(false), 0);
    if (!solutions.length) return `无解（搜索 ${nodes} 节点）`;
    return `找到 ${solutions.length}${solutions.length >= 10 ? "+" : ""} 个解（前 10 个，搜索 ${nodes} 节点）：\n${solutions.join("\n")}`;
  });

// ---------- Kakuro 数字组合 ----------
export const kakuroOps = runOp("dcode-extras-2026-10/game-kakuro", CAT, "Kakuro 组合枚举", "给定和与格数，枚举 1-9 不重复数字的全部组合；可排除已有数字",
  (t, p) => {
    const sum = Number((p && p.sum) || t) || 0;
    const len = Number((p && p.len) || 0) || 0;
    const excl = String((p && p.excl) || "").replace(/\D/g, "").split("").map(Number);
    if (!Number.isInteger(sum) || !Number.isInteger(len) || sum < 1 || len < 1 || len > 9) throw new Error("需要和与格数（1-9）");
    const avail = [1, 2, 3, 4, 5, 6, 7, 8, 9].filter((d) => !excl.includes(d));
    const out = [];
    const rec = (start, rest, k, acc) => {
      if (k === 0) { if (rest === 0) out.push(acc.join("")); return; }
      for (const d of avail) {
        if (d <= start) continue;
        if (d > rest) break;
        rec(d, rest - d, k - 1, [...acc, d]);
      }
    };
    rec(0, sum, len, []);
    if (!out.length) return `无组合（和=${sum}，格数=${len}${excl.length ? `，排除 ${excl.join(",")}` : ""}）`;
    return `和=${sum}，${len} 格${excl.length ? `，排除 ${excl.join(",")}` : ""} → ${out.length} 组：\n${out.join("\n")}`;
  }, [P("sum", "和", "17"), P("len", "格数 1-9", "3"), P("excl", "排除数字", "")]);

// ---------- Takuzu / Binairo ----------
export const takuzuOps = runOp("dcode-extras-2026-10/game-takuzu", CAT, "Takuzu/Binairo 求解", "0/1 谜题：每行每列 0/1 数量相等、无三连、行 列 互不重复。输入 n 行（_ 或 . 表示空）",
  (t) => {
    const rows = parseList(t).map((r) => r.replace(/[^01_.]/g, "").replace(/[_.]/g, "?"));
    const n = rows.length;
    if (n < 2 || n > 10 || n % 2 !== 0 || !rows.every((r) => r.length === n)) throw new Error("需要偶数 n（2..10）的 n×n 网格，空格用 _ 或 .");
    const bad = (s) => s.includes("000") || s.includes("111");
    const rowsSeen = new Set();
    const cols = [];
    let nodes = 0;
    const valid = (grid) => {
      for (const r of grid) if (bad(r)) return false;
      for (let c = 0; c < n; c++) {
        const col = grid.map((r) => r[c]).join("");
        if (bad(col)) return false;
      }
      return true;
    };
    const complete = (grid) => {
      if (!valid(grid)) return false;
      const rs = new Set(grid), cs = new Set();
      for (let c = 0; c < n; c++) cs.add(grid.map((r) => r[c]).join(""));
      if (rs.size !== n || cs.size !== n) return false;
      for (const r of grid) if ((r.match(/0/g) || []).length !== n / 2 || (r.match(/1/g) || []).length !== n / 2) return false;
      for (let c = 0; c < n; c++) {
        const col = grid.map((r) => r[c]).join("");
        if ((col.match(/0/g) || []).length !== n / 2) return false;
      }
      return true;
    };
    const solutions = [];
    const rec = (grid, r) => {
      if (++nodes > 2e6) throw new Error("搜索节点超 2e6");
      if (solutions.length > 1) return;
      if (r === n) { if (complete(grid)) solutions.push(grid.slice()); return; }
      const pat = rows[r];
      const cands = [];
      const gen = (i, acc) => {
        if (acc.includes("000") || acc.includes("111")) return;
        if (i === n) { cands.push(acc); return; }
        if (pat[i] === "?") { gen(i + 1, acc + "0"); gen(i + 1, acc + "1"); }
        else gen(i + 1, acc + pat[i]);
      };
      gen(0, "");
      for (const cand of cands) {
        if ((cand.match(/0/g) || []).length > n / 2 || (cand.match(/1/g) || []).length > n / 2) continue;
        grid.push(cand);
        if (valid(grid) && new Set(grid).size === grid.length) rec(grid, r + 1);
        grid.pop();
      }
    };
    rec([], 0);
    if (!solutions.length) return "无解（请检查输入）";
    if (solutions.length > 1) return "存在多个解（谜题不唯一），其中之一：\n" + solutions[0].join("\n");
    return "唯一解：\n" + solutions[0].join("\n");
  });

// ---------- 拉丁方 ----------
export const latinOps = runOp("dcode-extras-2026-10/game-latin", CAT, "拉丁方生成/校验（Carré Latin）", "生成 n 阶循环拉丁方（(i+j) mod n）；若输入网格（含 _ 空格）则校验规则或补全循环结构",
  (t, p) => {
    const src = String(t).trim();
    if (/^[\d_.\s]+$/.test(src) && src.includes("_")) {
      const rows = parseList(src).map((r) => r.replace(/[^0-9_]/g, ""));
      const n = rows.length;
      if (n < 2 || n > 12 || !rows.every((r) => r.length === n)) throw new Error("需要 n×n 网格（n=2..12），空格 _");
      const missing = [];
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (rows[i][j] === "_") missing.push([i, j]);
      // 单元约束传播 + 回溯
      let nodes = 0;
      const ok = (i, j, v, grid) => {
        for (let k = 0; k < n; k++) { if (grid[i][k] === v && k !== j) return false; if (grid[k][j] === v && k !== i) return false; }
        return true;
      };
      const grid = rows.map((r) => [...r]);
      const rec = (idx) => {
        if (++nodes > 1e6) throw new Error("搜索超限");
        if (idx === missing.length) return true;
        const [i, j] = missing[idx];
        for (let v = 1; v <= n; v++) {
          if (!ok(i, j, v, grid)) continue;
          grid[i][j] = v;
          if (rec(idx + 1)) return true;
          grid[i][j] = "_";
        }
        return false;
      };
      const has = rec(0);
      return has ? `补全（${missing.length} 空格）：\n${grid.map((r) => r.join("")).join("\n")}` : "无解";
    }
    const n = Number((p && p.n) || t) || 0;
    if (!Number.isInteger(n) || n < 2 || n > 26) throw new Error("给 n（2..26）生成循环拉丁方，或给带 _ 的网格");
    const sym = n <= 9;
    const rows = [];
    for (let i = 0; i < n; i++) {
      const row = [];
      for (let j = 0; j < n; j++) {
        const v = ((i + j) % n) + 1;
        row.push(sym ? String(v) : String.fromCharCode(64 + v));
      }
      rows.push(row.join(" "));
    }
    return `循环拉丁方 L(i,j) = (i+j) mod ${n} + 1：\n${rows.join("\n")}`;
  }, [P("n", "阶数（生成模式）", "5")]);

// ---------- 通用尺寸数独（4/6/9/12） ----------
export const sudokuOps = runOp("dcode-extras-2026-10/game-sudoku", CAT, "数独 · 尺寸泛化（4/6/9/12）", "标准盒式数独求解：4×4(2×2 盒)、6×6(2×3)、9×9(3×3)、12×12(3×4)。输入按行，0/_/. 为空；回溯+候选最少优先（9×9 已有数独插件，此为尺寸泛化）",
  (t) => {
    const rows = parseList(t).map((r) => r.replace(/[^0-9A-Za-z_.]/g, ""));
    const n = rows.length;
    const BOX = { 4: [2, 2], 6: [2, 3], 9: [3, 3], 12: [3, 4] };
    if (!BOX[n] || !rows.every((r) => r.length === n)) throw new Error("尺寸支持 4/6/9/12（n 行 n 列），空格用 0 或 _");
    const [bh, bw] = BOX[n];
    const ch = (d) => d < 10 ? String(d) : String.fromCharCode(55 + d); // 10→A 11→B
    const unch = (c) => c >= "1" && c <= "9" ? +c : c >= "A" && c <= "B" ? c.charCodeAt(0) - 55 : 0;
    const grid = rows.map((r) => [...r].map(unch));
    const V = (d) => d >= 1 && d <= n;
    for (const r of grid) for (const v of r) if (!V(v) && v !== 0) throw new Error(`数字 ${v} 超出 1..${n}`);
    let nodes = 0;
    const ok = (i, j, v) => {
      for (let k = 0; k < n; k++) { if (grid[i][k] === v || grid[k][j] === v) return false; }
      const r0 = Math.floor(i / bh) * bh, c0 = Math.floor(j / bw) * bw;
      for (let r = r0; r < r0 + bh; r++) for (let c = c0; c < c0 + bw; c++) if (grid[r][c] === v) return false;
      return true;
    };
    const empties = [];
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (!grid[i][j]) empties.push([i, j]);
    const rec = () => {
      if (++nodes > 3e6) throw new Error("搜索节点超 3e6");
      // 找候选最少的空格
      let best = null, bestC = null;
      for (const [i, j] of empties) {
        if (grid[i][j]) continue;
        const cand = [];
        for (let v = 1; v <= n; v++) if (ok(i, j, v)) cand.push(v);
        if (!cand.length) return false;
        if (!bestC || cand.length < bestC.length) { best = [i, j]; bestC = cand; if (cand.length === 1) break; }
      }
      if (!best) return true;
      const [i, j] = best;
      for (const v of bestC) {
        grid[i][j] = v;
        if (rec()) return true;
        grid[i][j] = 0;
      }
      return false;
    };
    const solved = rec();
    if (!solved) return "无解（请检查盘面）";
    return grid.map((r) => r.map(ch).join("")).join("\n") + `\n（${nodes} 节点）`;
  });

// ---------- Set（纸牌游戏集合） ----------
export const setOps = runOp("dcode-extras-2026-10/game-set", CAT, "Set 集合牌求解", "12 张牌找全部合法 Set（三张牌每项属性：全同或全不同）。牌记法：四个字符 数字 颜色 形状 填充，如 1RSD=1红菱实",
  (t) => {
    const cards = String(t).trim().split(/[\s,;]+/).filter(Boolean);
    if (cards.length < 3 || cards.length > 20) throw new Error("3..20 张牌，每张 4 字符（如 1RSD）");
    for (const c of cards) if (!/^[123][RGBP][SDO][SEHO]$/i.test(c)) throw new Error(`牌「${c}」记法应为：数量123 颜色RGB紫P 形状S菱O椭圆D? 详见说明`);
    const sets = [];
    for (let a = 0; a < cards.length; a++)
      for (let b = a + 1; b < cards.length; b++)
        for (let c = b + 1; c < cards.length; c++) {
          let okAll = true;
          for (let k = 0; k < 4; k++) {
            const s = new Set([cards[a][k].toUpperCase(), cards[b][k].toUpperCase(), cards[c][k].toUpperCase()]);
            if (s.size === 2) { okAll = false; break; }
          }
          if (okAll) sets.push(`${cards[a]} ${cards[b]} ${cards[c]}`);
        }
    return sets.length ? `找到 ${sets.length} 个 Set：\n${sets.join("\n")}` : "没有合法 Set";
  });

// ---------- 词典引擎（Boggle / Wordle / 字谜 / 模式） ----------
export const lexiconOps = runOp("dcode-extras-2026-10/game-lexicon", CAT, "词典求解引擎（词表自带）", "自带词表（每行一词）之上做：Boggle 网格搜词 / Wordle 反馈过滤 / 变位词 anagram / 模式匹配（. 任意、* 任意长）。dCode 内置法语词典，本件不捆绑词典、由用户提供（体积与授权考虑）",
  (t, p) => {
    const mode = String((p && p.mode) || "pattern");
    const parts = String(t).split(/^\s*={3,}\s*$/m);
    if (parts.length !== 2) throw new Error("上半区：查询（Boggle 网格行 / Wordle 反馈行 / 字母集 / 模式），一行 === 分隔，下半区：词表每行一词");
    const q = parts[0].trim(), words = parseList(parts[1]).map((w) => w.toUpperCase());
    if (!words.length || words.length > 200000) throw new Error("词表 1..200000 行");
    if (mode === "pattern") {
      const pat = new RegExp("^" + q.trim().replace(/[.+*?^${}()|[\]\\]/g, (c) => (c === "." ? "." : c === "*" ? ".*" : "\\" + c)) + "$", "i");
      const hits = words.filter((w) => pat.test(w));
      return hits.length ? `命中 ${hits.length} 词：\n${hits.slice(0, 500).join("\n")}${hits.length > 500 ? "\n…（截断到 500）" : ""}` : "无命中";
    }
    if (mode === "anagram") {
      const key = (w) => [...w].sort().join("");
      const k = key(q.replace(/[^A-Za-z]/g, "").toUpperCase());
      const hits = words.filter((w) => key(w) === k);
      return hits.length ? `字母集 ${k.split("").join(",")} 的变位词 ${hits.length} 个：\n${hits.join("\n")}` : "词表中无变位词";
    }
    if (mode === "wordle") {
      // 输入：既有猜测与反馈，每行 "stare : GYYB."（G绿 Y黄 .灰），多行
      const hist = parseList(q).map((l) => {
        const m = l.replace(/\s/g, "").match(/^([A-Za-z]+):([GY.]+)$/);
        if (!m) throw new Error(`反馈行「${l}」格式应为 stare:GYYB.`);
        if (m[1].length !== m[2].length) throw new Error(`「${l}」猜测与反馈长度不一致`);
        return { g: m[1].toUpperCase(), f: m[2] };
      });
      if (!hist.length) throw new Error("至少一行「stare:GYYB.»");
      const L = hist[0].g.length;
      const filter = (w) => {
        if (w.length !== L) return false;
        for (const { g, f } of hist) {
          const rest = [...w];
          for (let i = 0; i < L; i++) {
            if (f[i] === "G") { if (w[i] !== g[i]) return false; rest[i] = null; }
          }
          for (let i = 0; i < L; i++) {
            if (f[i] === "Y") {
              const k = rest.indexOf(g[i]);
              if (k < 0) return false;
              rest[k] = null;
            } else if (f[i] === "." && w[i] === g[i]) return false;
          }
          // 灰的总量校验（出现次数不超过非绿提示数）
          for (let i = 0; i < L; i++) {
            if (f[i] === ".") {
              const cntG = [...f].filter((x, j) => x === "G" && g[j] === g[i]).length;
              const cntY = [...f].filter((x, j) => x === "Y" && g[j] === g[i]).length;
              const inW = [...w].filter((c) => c === g[i]).length;
              if (inW > cntG + cntY) return false;
            }
          }
        }
        return true;
      };
      const hits = words.filter(filter);
      return hits.length ? `剩余候选 ${hits.length} 个：\n${hits.slice(0, 300).join("\n")}${hits.length > 300 ? "\n…（截断到 300）" : ""}` : "无候选（反馈矛盾或词表缺失）";
    }
    if (mode === "boggle") {
      const rows = parseList(q).map((r) => r.toUpperCase());
      const R = rows.length, C = rows[0].length;
      if (R < 2 || C < 2 || R * C > 36 || !rows.every((r) => r.length === C)) throw new Error("Boggle 网格需 ≥2 行且行长一致（≤36 格），每行一项");
      const wordSet = new Set(words.filter((w) => w.length >= 3));
      const found = new Map();
      const dirs = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
      let paths = 0;
      const rec = (r, c, s, used, word) => {
        if (++paths > 2e6) throw new Error("路径搜索超 2e6（网格过大或词表过密）");
        s += rows[r][c]; used.add(r * C + c);
        if (wordSet.has(s)) found.set(s, (found.get(s) || 0) + 1);
        for (const [dr, dc] of dirs) {
          const nr = r + dr, nc = c + dc;
          if (nr < 0 || nc < 0 || nr >= R || nc >= C || used.has(nr * C + nc)) continue;
          rec(nr, nc, s, used, word);
        }
        used.delete(r * C + c);
      };
      for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) rec(r, c, "", new Set());
      const list = [...found.keys()].sort((a, b) => b.length - a.length || a.localeCompare(b));
      return list.length ? `网格找到 ${list.length} 词：\n${list.join("\n")}` : "词表中无词可由网格路径拼出";
    }
    throw new Error(`未知模式 ${mode}`);
  }, [SEL("mode", "模式", "pattern", [{ value: "pattern", label: "模式匹配" }, { value: "anagram", label: "变位词" }, { value: "wordle", label: "Wordle 过滤" }, { value: "boggle", label: "Boggle 网格" }])]);

export const OPS = [
  taquinOps, hanoiOps, lightsoutOps, bullscowsOps, cryptarithmOps, kakuroOps,
  takuzuOps, latinOps, sudokuOps, setOps, lexiconOps,
];
