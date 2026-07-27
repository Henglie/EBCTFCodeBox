/*
 * nonogram.js — 数织 / Nonogram（行列约束求解，cat:'analysis'，run 型）。
 *
 * 定位：CTF misc。给定每行/每列的「连续块长度」约束，求解 0/1 点阵
 * 解出的图案常是二维码/字符/flag 形状。对应 all-in-one tem_exp_add「数织」项。
 *
 * 输入格式（两段，用一行 "---" 分隔；缺省列段则视为方阵按行段推断不可行——必须两段）：
 * 行约束段：每行一组，空格分隔的数字（如 "3 1"），空行=该行全空（写 0 或留空）
 * ---
 * 列约束段：每列一组，同上
 *
 * 例：
 * 2
 * 1 1
 * 3
 * ---
 * 1
 * 1 1 1
 * 2
 *
 * 算法：线求解器（line solver）迭代收敛。
 * 1. 对每行/每列枚举所有满足该线约束的合法排布（受已知格约束剪枝）
 * 2. 取所有合法排布的交集：某格在全部排布中都为实/都为空 → 确定该格
 * 3. 反复扫行、扫列直到无新确定格
 * 4. 若全确定 → 唯一解；若有剩余不确定 → 输出部分解 + 提示（不做整盘 DFS 回溯，防爆）
 *
 * 防爆：
 * - 尺寸上限 40×40
 * - 单线合法排布枚举上限（组合数 > 200000 该线跳过，标记不可解）
 * - 总迭代轮数上限 200
 *
 * 契约：register({id, cat:'analysis', name, desc, params, run})。
 * 红线：算法层零 UI 依赖（仅 registry）；零外发纯本地；件内自注册。
 *
 * 参考：Nonogram line-solver 标准算法（Wikipedia Nonogram）+ all-in-one 决策案。
 */
import { register } from "./registry.js";

const MAX_SIZE = 40;
const MAX_LINE_COMBOS = 200000;

// 解析一段约束：每行 → 数字数组。空行 → []（全空）
function parseClues(block) {
  return block.split("\n").map((line) => {
    const nums = line.trim().split(/[\s,]+/).map((x) => parseInt(x, 10)).filter((x) => !isNaN(x) && x > 0);
    return nums; // 空 → []
  });
}

// 枚举长度 len 的一条线满足 clue（连续块）的所有排布。
// known: Int8Array(len)，-1=未知 0=空 1=实；用于剪枝。
// 返回 { rows: Array<Int8Array> } 或 null（超上限）。
function enumerateLine(len, clue, known) {
  const results = [];
  const k = clue.length;
 // 无块 → 整行空（若已知含实则不合法）
  if (k === 0) {
    for (let i = 0; i < len; i++) if (known[i] === 1) return { rows: [] };
    return { rows: [new Int8Array(len)] };
  }
  const sum = clue.reduce((a, b) => a + b, 0);
  const slack = len - sum - (k - 1); // 可分配的额外空格数
  if (slack < 0) return { rows: [] };

 // 组合数估算（隔板法 C(slack+k, k)），超上限放弃枚举
  let combos = 1;
  for (let i = 1; i <= k; i++) { combos = combos * (slack + i) / i; if (combos > MAX_LINE_COMBOS) break; }
  if (combos > MAX_LINE_COMBOS) return null;

  const line = new Int8Array(len);
 // gaps[0..k]：块前的空格数，gaps[0]>=0，中间>=1，尾部>=0，总空=len-sum
  function place(blockIdx, pos) {
    if (blockIdx === k) {
 // 剩余全空
      for (let i = pos; i < len; i++) {
        if (known[i] === 1) return;
        line[i] = 0;
      }
 // 校验通过 → 收录
      results.push(Int8Array.from(line));
      return;
    }
    const blockLen = clue[blockIdx];
 // 该块起点 start 从 pos 到 len-剩余需求
    const remainingBlocks = clue.slice(blockIdx).reduce((a, b) => a + b, 0) + (k - blockIdx - 1);
    const maxStart = len - remainingBlocks;
    for (let start = pos; start <= maxStart; start++) {
 // start 前的空格
      let ok = true;
      for (let i = pos; i < start; i++) {
        if (known[i] === 1) { ok = false; break; }
      }
      if (!ok) continue;
 // 放块
      for (let i = start; i < start + blockLen; i++) {
        if (known[i] === 0) { ok = false; break; }
      }
      if (!ok) continue;
 // 块后强制一个空（除非最后一块）
      const afterPos = start + blockLen;
      if (blockIdx < k - 1) {
        if (afterPos >= len || known[afterPos] === 1) continue;
      }
 // 落笔
      for (let i = pos; i < start; i++) line[i] = 0;
      for (let i = start; i < afterPos; i++) line[i] = 1;
      if (blockIdx < k - 1) {
        line[afterPos] = 0;
        place(blockIdx + 1, afterPos + 1);
      } else {
        place(blockIdx + 1, afterPos);
      }
    }
  }
  place(0, 0);
  return { rows: results };
}

// 对一条线：取所有合法排布的交集，回填 known。返回 {changed, feasible}
function reduceLine(len, clue, known) {
  const en = enumerateLine(len, clue, known);
  if (en === null) return { changed: false, feasible: true, skipped: true };
  const rows = en.rows;
  if (rows.length === 0) return { changed: false, feasible: false };
  let changed = false;
  for (let i = 0; i < len; i++) {
    if (known[i] !== -1) continue;
    let all1 = true, all0 = true;
    for (const r of rows) {
      if (r[i] === 1) all0 = false; else all1 = false;
      if (!all0 && !all1) break;
    }
    if (all1) { known[i] = 1; changed = true; }
    else if (all0) { known[i] = 0; changed = true; }
  }
  return { changed, feasible: true };
}

function solveNonogram(rowClues, colClues) {
  const rows = rowClues.length;
  const cols = colClues.length;
 // grid[r][c]: -1 未知 0 空 1 实
  const grid = Array.from({ length: rows }, () => new Int8Array(cols).fill(-1));

  let round = 0;
  let anySkipped = false;
  while (round++ < 200) {
    let changed = false;
 // 扫行
    for (let r = 0; r < rows; r++) {
      const known = grid[r];
      const res = reduceLine(cols, rowClues[r], known);
      if (res.skipped) anySkipped = true;
      if (!res.feasible) return { grid, feasible: false, where: "行 " + (r + 1) };
      if (res.changed) changed = true;
    }
 // 扫列
    for (let c = 0; c < cols; c++) {
      const known = new Int8Array(rows);
      for (let r = 0; r < rows; r++) known[r] = grid[r][c];
      const res = reduceLine(rows, colClues[c], known);
      if (res.skipped) anySkipped = true;
      if (!res.feasible) return { grid, feasible: false, where: "列 " + (c + 1) };
      if (res.changed) {
        for (let r = 0; r < rows; r++) grid[r][c] = known[r];
        changed = true;
      }
    }
    if (!changed) break;
  }

  let unknown = 0;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (grid[r][c] === -1) unknown++;
  return { grid, feasible: true, unknown, anySkipped };
}

function renderGrid(grid, fillCh, emptyCh, unkCh) {
  return grid.map((row) =>
    Array.from(row).map((v) => (v === 1 ? fillCh : v === 0 ? emptyCh : unkCh)).join("")
  ).join("\n");
}

function nonogramRun(text, p) {
  const raw = String(text == null ? "" : text).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = [];
  lines.push("=== 数织 / Nonogram 求解 ===");
  lines.push("");

 // 分隔符 ---（一整行）
  const sepIdx = raw.split("\n").findIndex((l) => /^-{3,}$/.test(l.trim()));
  if (sepIdx < 0) {
    lines.push("✗ 输入需两段（行约束 / 列约束），用一行 --- 分隔。");
    lines.push("");
    lines.push("格式示例：");
    lines.push("  2");
    lines.push("  1 1");
    lines.push("  3");
    lines.push("  ---");
    lines.push("  1");
    lines.push("  1 1 1");
    lines.push("  2");
    lines.push("");
    lines.push("说明：上段每行一组行约束（连续块长度，空格分隔），下段每行一组列约束。");
    return lines.join("\n");
  }
  const allLines = raw.split("\n");
  const rowBlock = allLines.slice(0, sepIdx).join("\n");
  const colBlock = allLines.slice(sepIdx + 1).join("\n");

 // 解析（去掉两段各自尾部空行）
  const trimTail = (arr) => { while (arr.length && arr[arr.length - 1].length === 0) arr.pop(); return arr; };
  const rowClues = trimTail(parseClues(rowBlock));
  const colClues = trimTail(parseClues(colBlock));

  const rows = rowClues.length, cols = colClues.length;
  if (rows === 0 || cols === 0) {
    lines.push("✗ 行约束或列约束为空。");
    return lines.join("\n");
  }
  if (rows > MAX_SIZE || cols > MAX_SIZE) {
    lines.push("✗ 尺寸超上限（" + MAX_SIZE + "×" + MAX_SIZE + "）：当前 " + rows + "×" + cols + "。");
    return lines.join("\n");
  }

 // 约束合法性：每行块和 + 间隔 ≤ cols；每列同理
  for (let r = 0; r < rows; r++) {
    const need = rowClues[r].reduce((a, b) => a + b, 0) + Math.max(0, rowClues[r].length - 1);
    if (need > cols) { lines.push("✗ 行 " + (r + 1) + " 约束需 " + need + " 格 > 列数 " + cols + "。"); return lines.join("\n"); }
  }
  for (let c = 0; c < cols; c++) {
    const need = colClues[c].reduce((a, b) => a + b, 0) + Math.max(0, colClues[c].length - 1);
    if (need > rows) { lines.push("✗ 列 " + (c + 1) + " 约束需 " + need + " 格 > 行数 " + rows + "。"); return lines.join("\n"); }
  }

  const fillCh = (p && p.fillCh) || "█";
  const emptyCh = (p && p.emptyCh) || "·";

  const res = solveNonogram(rowClues, colClues);
  lines.push("盘面: " + rows + " 行 × " + cols + " 列");
  lines.push("");

  if (!res.feasible) {
    lines.push("✗ 无解（约束在 " + res.where + " 处矛盾）。检查行/列约束是否抄错。");
    return lines.join("\n");
  }

  lines.push("--- 解 ---");
  lines.push(renderGrid(res.grid, fillCh, emptyCh, "?"));
  lines.push("");
  if (res.unknown > 0) {
    lines.push("⚠ 剩 " + res.unknown + " 格未确定（? 表示）。本 op 用线求解器（不做整盘回溯），");
    lines.push("  多解或需猜测的盘面无法全解。若图案已可辨认（如二维码/字符）即可读出。");
    if (res.anySkipped) lines.push("  （部分线组合数过大被跳过，结果可能欠收敛）");
  } else {
    lines.push("✓ 唯一解，全部确定。");
  }
  return lines.join("\n");
}

register({
  id: "nonogram",
  cat: "analysis",
  name: "数织 / Nonogram 求解",
  desc: "给行/列连续块约束求解 0/1 点阵（图案常是二维码/字符/flag）。线求解器迭代收敛，两段输入用 --- 分隔，上限 40×40",
  params: [
    { key: "fillCh", label: "实心格字符", type: "text", default: "█", placeholder: "默认 █" },
    { key: "emptyCh", label: "空格字符", type: "text", default: "·", placeholder: "默认 ·" },
  ],
  run: nonogramRun,
});

export { solveNonogram, enumerateLine, reduceLine, parseClues };
