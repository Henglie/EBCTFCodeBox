/*
 * qrgeom.js — QR 几何归一化与鲁棒定位符检测
 *
 * 纯函数模块，零 UI 依赖，可 Node 直测、可 Worker 调用。
 *
 * 职责限于「几何层」：极性归一、鲁棒 finder 检测、方向/镜像归一、
 * 缺角兜底推算。解码本身由调用方以 callback 注入（本模块不 import 任何
 * 解码实现，保持解耦）。
 *
 * ------------------------------------------------------------------
 * 权威依据
 * - ISO/IEC 18004：
 *   - 定位图案（finder pattern）为 7×7，位于三个角（左上、右上、左下），
 *     右下一角留空（用于定向），见条款 6.3.2 与 Figure 23/24。
 *   - finder 的中央一行/列为「暗-亮-暗-亮-暗 = 1:1:3:1:1」模块比例
 *     （中央 3×3 暗块，两侧各 1 模块暗、夹 1 模块亮）——这是 finder 的
 *     标志性几何特征，见条款 6.3.2。
 *   - 对齐图案（alignment pattern）为 5×5，仅作区分说明，本模块不依赖。
 *   - 格式信息 15 位（5 位数据 + BCH(15,5)，再与 0x5412 异或），
 *     见条款 6.9.1；版本信息 18 位（BCH(18,6)，v≥7），见条款 6.10。
 * - 思路借鉴：scanline 比例 1:1:3:1:1 判定 finder 的思路来自公开实现
 *   jsqrcode（Apache-2.0 许可）。本文件仅借鉴该「比例判定」思路，未复制
 *   其代码，且按 ISO/IEC 18004 的 finder 几何自研实现。
 * ------------------------------------------------------------------
 */

// ============================================================
// 基础工具
// ============================================================

// 极性反转：0↔1。ISO/IEC 18004 中「暗=1、亮=0」；
// 反色图（白码黑底）即整体极性互换。
export function invertMatrix(mat) {
  const n = mat.length;
  const out = new Array(n);
  for (let y = 0; y < n; y++) {
    const row = mat[y];
    const o = new Array(row.length);
    for (let x = 0; x < row.length; x++) o[x] = row[x] ? 0 : 1;
    out[y] = o;
  }
  return out;
}

function hamming15(a, b) {
  let x = a ^ b, d = 0;
  while (x) { d += x & 1; x >>= 1; }
  return d;
}

// ============================================================
// 格式信息（BCH(15,5)）— ISO/IEC 18004 §6.9.1
// 仅用于缺角兜底时重绘/读取格式位，属规范数学，非第三方代码。
// ============================================================

function formatBits15(ecl, mask) {
  const data = ((ecl & 0x3) << 3) | (mask & 0x7); // 5-bit
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}

function getBit(x, i) { return ((x >>> i) & 1) !== 0; }

// 从矩阵读格式信息，返回 { ecl, mask, dist }（取两份最近合法码）。
// 坐标摆放严格按 ISO/IEC 18004（与 qrcode.js 一致，本模块自研实现）。
export function readFormatEclMask(mat, size) {
  const pos1 = [
    [8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5],
    [8, 7], [8, 8], [7, 8],
    [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8],
  ];
  const pos2 = [
    [size - 1, 8], [size - 2, 8], [size - 3, 8], [size - 4, 8],
    [size - 5, 8], [size - 6, 8], [size - 7, 8],
    [size - 8, 8], [8, size - 7], [8, size - 6], [8, size - 5],
    [8, size - 4], [8, size - 3], [8, size - 2], [8, size - 1],
  ];
  let b1 = 0, b2 = 0;
  for (let i = 0; i < 15; i++) {
    if (mat[pos1[i][1]] && mat[pos1[i][1]][pos1[i][0]]) b1 |= (1 << i);
    if (mat[pos2[i][1]] && mat[pos2[i][1]][pos2[i][0]]) b2 |= (1 << i);
  }
  let best = -1, bestD = 99;
  for (let d = 0; d < 32; d++) {
    const code = formatBits15(d >> 3, d & 7);
    const dd = Math.min(hamming15(b1, code), hamming15(b2, code));
    if (dd < bestD) { bestD = dd; best = d; }
  }
  return { ecl: (best >> 3) & 0x3, mask: best & 0x7, dist: bestD };
}

// 在三个角（左上/右上/左下）重绘格式信息（同一 15 位码的两份拷贝）。
// 坐标严格按 ISO/IEC 18004 §6.9.1。固定暗模块一并重绘。
export function drawFormatBitsAll(mat, size, ecl, mask) {
  const bits = formatBits15(ecl, mask);
  const set = (x, y, v) => {
    if (x >= 0 && x < size && y >= 0 && y < size) mat[y][x] = v ? 1 : 0;
  };
  // 第一份（左上 finder 周围 L 形）
  for (let i = 0; i <= 5; i++) set(8, i, getBit(bits, i));
  set(8, 7, getBit(bits, 6));
  set(8, 8, getBit(bits, 7));
  set(7, 8, getBit(bits, 8));
  for (let i = 9; i < 15; i++) set(14 - i, 8, getBit(bits, i));
  // 第二份（右上竖条 + 左下横条）
  for (let i = 0; i < 8; i++) set(size - 1 - i, 8, getBit(bits, i));
  for (let i = 8; i < 15; i++) set(8, size - 15 + i, getBit(bits, i));
  // 固定暗模块（条款 6.9.1）
  set(8, size - 8, 1);
}

// 在 (ox,oy) 画标准 7×7 定位符 + 1 模块分隔符（ISO/IEC 18004 §6.3.2）。
export function drawStandardFinder(mat, size, ox, oy) {
  for (let dy = -1; dy <= 7; dy++) {
    for (let dx = -1; dx <= 7; dx++) {
      const x = ox + dx, y = oy + dy;
      if (x < 0 || x >= size || y < 0 || y >= size) continue;
      if (dx >= 0 && dx <= 6 && dy >= 0 && dy <= 6) {
        const dist = Math.max(Math.abs(dx - 3), Math.abs(dy - 3));
        mat[y][x] = (dist !== 2 && dist !== 4) ? 1 : 0; // 外环/中心暗，夹心亮
      } else {
        mat[y][x] = 0; // 分隔符（亮）
      }
    }
  }
}

// ============================================================
// 鲁棒 finder 检测（scanline 1:1:3:1:1）
// 思路：对每一行做游程编码，滑动 5 段交替游程窗，判定 1:1:3:1:1 比例；
// 再在候选中心列做竖向验证。finder 自身 90°/180°/270° 旋转与镜像均对称，
// 故该判定天然支持任意朝向与镜像；finderColor 参数支持暗/亮互换（反色）。
// ============================================================

// 单行游程编码：[{color, len, start}]
function rleLine(line) {
  const runs = [];
  let i = 0;
  const n = line.length;
  while (i < n) {
    const c = line[i];
    let j = i;
    while (j < n && line[j] === c) j++;
    runs.push({ color: c, len: j - i, start: i });
    i = j;
  }
  return runs;
}

// 在游程序列中匹配「1:1:3:1:1」窗（窗口起点 s）。
// 判据（ISO/IEC 18004 §6.3.2 的 1:1:3:1:1 比例）：
//  - 5 段交替，且第 0/2/4 段为 finderColor，第 1/3 段为相反色；
//  - 中央（第 2）段为严格最长，且长度在 [2,6]（典型 3，即 3×3 暗核），
//    且中央长度 ≥ 2× 最大外侧长度（比例约束，抑制时序/格式区的伪命中）；
//  - 四段外侧长度均「细」（1..3），对应 finder 外环与夹心亮带。
// 返回 {center, lens} 或 null。
function matchWindowAt(runs, s, finderColor) {
  const r0 = runs[s], r1 = runs[s + 1], r2 = runs[s + 2],
        r3 = runs[s + 3], r4 = runs[s + 4];
  if (r0.color !== finderColor) return null;
  if (r2.color !== finderColor) return null;
  if (r4.color !== finderColor) return null;
  if (r1.color === finderColor) return null;
  if (r3.color === finderColor) return null;
  const c2 = r2.len;
  if (c2 < 2 || c2 > 6) return null;                 // 中央 3×3 暗核（容差）
  const maxOuter = Math.max(r0.len, r1.len, r3.len, r4.len);
  if (!(c2 > r0.len && c2 > r1.len && c2 > r3.len && c2 > r4.len)) return null;
  if (c2 < 2 * maxOuter) return null;                 // 1:1:3:1:1 比例约束
  if (maxOuter < 1 || maxOuter > 3) return null;
  return { center: r2.start + (r2.len >> 1), lens: [r0.len, r1.len, r2.len, r3.len, r4.len] };
}

// 在游程序列中找所有 1:1:3:1:1 窗（一行/列可能含多个 finder 或伪命中）。
function findFinderRuns(runs, finderColor) {
  const out = [];
  for (let s = 0; s + 5 <= runs.length; s++) {
    const m = matchWindowAt(runs, s, finderColor);
    if (m) out.push(m);
  }
  return out;
}

// 外环确认：7×7 finder 与 5×5 对齐图案的中心十字都是 1:1:3:1:1，
// 但 finder 是 7×7（外环中点距中心 3 模块，为暗），对齐图案是 5×5（距中心 3
// 已在其外，为亮/数据）。故在候选圆心四个方向距 3 处查外环中点，至少 3/4 命中
// finderColor 即确认（ISO/IEC 18004 §6.3.2 finder 为 7×7，§6.3.3 对齐为 5×5）。
// 该判据同时抑制数据区的偶发 1:1:3:1:1 伪命中。
export function isFinderRingConfirmed(mat, cx, cy, size, finderColor) {
  const pts = [[cx - 3, cy], [cx + 3, cy], [cx, cy - 3], [cx, cy + 3]];
  let hit = 0;
  for (const [x, y] of pts) {
    if (x < 0 || x >= size || y < 0 || y >= size) continue; // 越界（非角落 finder）不计
    if (mat[y][x] === finderColor) hit++;
  }
  return hit >= 3;
}

// 扫描整矩阵，返回 finder 中心列表 [{cx, cy}]（中心模块坐标）。
// finderColor：1=暗心，0=亮心（反色时）。
export function findFinderCenters(mat, size, finderColor = 1) {
  const candidates = [];
  // 横向：每行找全部 1:1:3:1:1 窗，记录候选中心 (cx, y)
  for (let y = 0; y < size; y++) {
    const runs = rleLine(mat[y]);
    for (const m of findFinderRuns(runs, finderColor)) {
      candidates.push({ cx: m.center, cy: y });
    }
  }
  // 竖向验证：对横向候选，在列 cx 上找 1:1:3:1:1，且中央落在 cy 附近
  const verified = [];
  for (const c of candidates) {
    const col = new Array(size);
    for (let y = 0; y < size; y++) col[y] = mat[y][c.cx];
    const runs = rleLine(col);
    let best = null;
    for (let s = 0; s + 5 <= runs.length; s++) {
      const m = matchWindowAt(runs, s, finderColor);
      if (m && Math.abs(m.center - c.cy) <= 1) { best = m; break; }
    }
    if (best && isFinderRingConfirmed(mat, c.cx, best.center, size, finderColor)) {
      verified.push({ cx: c.cx, cy: best.center });
    }
  }
  // 去重：中心距离 < 6 视为同一 finder，保留其一
  const out = [];
  for (const v of verified) {
    let dup = false;
    for (const o of out) {
      if (Math.abs(o.cx - v.cx) <= 5 && Math.abs(o.cy - v.cy) <= 5) { dup = true; break; }
    }
    if (!dup) out.push(v);
  }
  // 统一以 {x,y} 形式返回圆心（下游方向/缺角逻辑均按 {x,y} 处理）
  return out.map((v) => ({ x: v.cx, y: v.cy }));
}

// 中心坐标 → 7×7 左上原点（finder 居中于中心模块，向外 3 模块）。
export function centerToOrigin(c) { return { x: c.cx - 3, y: c.cy - 3 }; }

// 找 finder 的左上原点列表。
export function findFinders(mat, size, finderColor = 1, tol = 1) {
  return findFinderCenters(mat, size, finderColor, tol).map(centerToOrigin);
}

// 极性感知检测：暗/亮互换 + 必要时整体反色，带明确短路与预算。
// 预算上限：最多 2 次 findFinders（暗、亮）+ 1 次整体反色后再查暗。
// 返回 { finders, inverted, matrix }：inverted 表示最终所用矩阵已反色。
// finders 为「圆心」坐标列表（{cx,cy}）；圆心随等距变换按点变换，
// 故方向匹配用圆心而非左上原点（原点在旋转时会偏移）。
export function detectFindersPolarity(mat, size) {
  // 1) 当前矩阵按暗心找
  let f = findFinderCenters(mat, size, 1);
  if (f.length >= 3) return { finders: f, inverted: false, matrix: mat };
  // 2) 当前矩阵按亮心找（说明 finder 为亮，矩阵整体已反色语义）
  let fl = findFinderCenters(mat, size, 0);
  if (fl.length >= 3) return { finders: fl, inverted: true, matrix: invertMatrix(mat) };
  // 3) 整体反色后按暗心找（覆盖背景并入导致亮心窗被破坏的情形）
  const inv = invertMatrix(mat);
  let fi = findFinderCenters(inv, size, 1);
  if (fi.length >= 3) return { finders: fi, inverted: true, matrix: inv };
  // 兜底：返回命中最多者（仍交由上层判定是否够 3 个）
  const bestDark = (f.length >= fl.length)
    ? { finders: f, inverted: false, matrix: mat }
    : { finders: fl, inverted: false, matrix: mat };
  return (fi.length > bestDark.finders.length)
    ? { finders: fi, inverted: true, matrix: inv }
    : bestDark;
}

// ============================================================
// 方向 / 镜像归一（ISO/IEC 18004 §6.3.2：三 finder 直角定向上）
// 利用正方形的二面体群 D4（8 个等距变换）枚举，挑选能把已检测 finder
// 对齐到标准三角（左上(0,0)、右上(size-7,0)、左下(0,size-7)）的变换。
// finder 自身对称，故旋转/镜像不改变其外观；变换作用于整矩阵即可把数据
// 一并校正到标准朝向。
// ============================================================

// 8 个等距变换：源 (x,y) → 目标 (x',y')（size = S）
export const ISOMETRIES = [
  { name: "none",      f: (x, y, S) => [x, y] },
  { name: "rot90",     f: (x, y, S) => [S - 1 - y, x] },
  { name: "rot180",    f: (x, y, S) => [S - 1 - x, S - 1 - y] },
  { name: "rot270",    f: (x, y, S) => [y, S - 1 - x] },
  { name: "flipH",     f: (x, y, S) => [S - 1 - x, y] },
  { name: "flipV",     f: (x, y, S) => [x, S - 1 - y] },
  { name: "transpose", f: (x, y, S) => [y, x] },
  { name: "antiTrans", f: (x, y, S) => [S - 1 - y, S - 1 - x] },
];

// 把等距变换应用到整矩阵（精确模块置换，无损失）。
export function applyIso(mat, size, iso) {
  const out = Array.from({ length: size }, () => new Array(size).fill(0));
  for (let y = 0; y < size; y++) {
    const row = mat[y];
    for (let x = 0; x < size; x++) {
      const [x2, y2] = iso.f(x, y, size);
      out[y2][x2] = row[x];
    }
  }
  return out;
}

// 标准三角（finder 圆心坐标）：左上(3,3)、右上(size-4,3)、左下(3,size-4)
function canonicalCenters(size) {
  return [
    { x: 3, y: 3 },
    { x: size - 4, y: 3 },
    { x: 3, y: size - 4 },
  ];
}

// 判断哪个等距变换能把最多 finder 圆心对齐到标准三角。
// 圆心随等距变换按点变换（与 applyIso 一致），故可用于方向匹配。
// 采用「贪心匹配 + 计分」而非全体集合相等：可容忍个别伪命中
// （数据/时序区偶发的 1:1:3:1:1 误检）与 ≤2 模块的检测抖动。
// 返回候选等距变换名数组（得分最高且 ≥3；当源已近标准时，identity 与
// transpose 同分，产生 2 路歧义，由上层解码择优）。
export function orientationCandidates(finders, size) {
  const canon = canonicalCenters(size);
  let best = [], bestScore = 2; // 至少需 3 个对齐才算有效定向
  for (const iso of ISOMETRIES) {
    const tf = finders.map((f) => {
      const [x2, y2] = iso.f(f.x, f.y, size);
      return { x: x2, y: y2 };
    });
    // 贪心：每个变换后圆心就近匹配一个标准圆心（每个标准圆心至多一次），容差 3 模块
    const used = new Array(canon.length).fill(false);
    let score = 0;
    for (const p of tf) {
      let bi = -1, bd = 1e9;
      for (let k = 0; k < canon.length; k++) {
        if (used[k]) continue;
        const d = Math.abs(p.x - canon[k].x) + Math.abs(p.y - canon[k].y);
        if (d <= 3 && d < bd) { bd = d; bi = k; }
      }
      if (bi >= 0) { used[bi] = true; score++; }
    }
    if (score > bestScore) { bestScore = score; best = [iso.name]; }
    else if (score === bestScore && score >= 3) best.push(iso.name);
  }
  return best;
}

// 归一整矩阵：给定 finder 圆心，挑候选等距变换并应用。
// 返回 { matrices: [{name, matrix}], candidates }。
export function normalizeOrientation(matrix, size, finders) {
  const names = orientationCandidates(finders, size);
  const matrices = names.map((nm) => {
    const iso = ISOMETRIES.find((i) => i.name === nm);
    return { name: nm, matrix: applyIso(matrix, size, iso) };
  });
  return { candidates: names, matrices };
}

// ============================================================
// 缺角兜底：已知 2 个 finder + 模块尺寸，推算第 3 个期望位置
// ISO/IEC 18004 §6.3.2：三 finder 占三角、右下留空。故缺失角即「三标准圆心中
// 没有被检测到的那个」。返回其圆心坐标（仅几何推算，不依赖该角像素）。
// ============================================================
export function predictThirdFinder(finders, size) {
  const canon = canonicalCenters(size);
  for (const c of canon) {
    let covered = false;
    for (const f of finders) {
      if (Math.abs(f.x - c.x) <= 7 && Math.abs(f.y - c.y) <= 7) { covered = true; break; }
    }
    if (!covered) return { x: c.x, y: c.y, corner: cornerName(c, size) };
  }
  return null; // 三角均被覆盖，非缺角情形
}

function cornerName(c, size) {
  if (c.x === 3 && c.y === 3) return "TL";
  if (c.x === size - 4 && c.y === 3) return "TR";
  return "BL";
}

// ============================================================
// 端到端几何归一（供接线参考）
// 返回 { matrix, inverted, isometry, finders, predictedThird }
// 不调用解码器；解码由调用方用归一后矩阵喂 qrDecodeMatrix。
// ============================================================
export function geometryNormalize(matrix, size, opts = {}) {
  const { allowMissing = true } = opts;
  const det = detectFindersPolarity(matrix, size);
  let finders = det.finders;
  let predictedThird = null;

  if (finders.length < 3 && finders.length >= 2 && allowMissing) {
    predictedThird = predictThirdFinder(finders, size);
    if (predictedThird) finders = finders.concat([{ x: predictedThird.x, y: predictedThird.y }]);
  }

  const norm = normalizeOrientation(det.matrix, size, finders);
  if (!norm.candidates.length) {
    return { matrix: det.matrix, inverted: det.inverted, isometry: null,
             finders: det.finders, predictedThird };
  }
  // 默认取首个候选（唯一时即为解；identity/transpose 歧义由解码层择优）
  const chosen = norm.matrices[0];
  return {
    matrix: chosen.matrix, inverted: det.inverted, isometry: chosen.name,
    finders: det.finders, predictedThird, candidates: norm.candidates,
  };
}

// ============================================================
// 解码调度（几何感知）：注入 decoder(matrix, w, h) → 结果或抛错
// 处理：极性归一 → 3 finder 方向归一（含 identity/transpose 歧义多试）
//     → 2 finder 缺角兜底（推算+重绘定位符/格式后解）
// 预算：每个几何候选至多 1 次解码尝试；3 finder 至多 2 路（歧义），
//      2 finder 至多 1 路归一 + 1 次重建解码。
// ============================================================
export function decodeGeometryAware(matrix, size, decoder) {
  const det = detectFindersPolarity(matrix, size);
  let finders = det.finders;
  const base = { inverted: det.inverted };

  if (finders.length >= 3) {
    const cand = orientationCandidates(finders, size);
    let lastErr = null;
    for (const nm of (cand.length ? cand : ["none"])) {
      const iso = ISOMETRIES.find((i) => i.name === nm);
      const norm = applyIso(det.matrix, size, iso);
      try {
        const r = decoder(norm, size, size);
        return { ok: true, inverted: det.inverted, isometry: nm, result: r };
      } catch (e) { lastErr = e; }
    }
    return { ok: false, inverted: det.inverted, reason: "orientation-normalized but decode failed",
             finders: finders.length, candidates: cand, error: lastErr && lastErr.message };
  }

  if (finders.length === 2) {
    const pred = predictThirdFinder(finders, size);
    if (!pred) return { ok: false, reason: "two finders but cannot predict third", finders: 2 };
    const f3 = finders.concat([{ x: pred.x, y: pred.y }]);
    const cand = orientationCandidates(f3, size);
    let lastErr = null;
    for (const nm of (cand.length ? cand : ["none"])) {
      const iso = ISOMETRIES.find((i) => i.name === nm);
      const norm = applyIso(det.matrix, size, iso);
      // 缺角重建：在推算出的缺失角（圆心→左上原点）画标准定位符 + 重绘全部格式信息
      try {
        const fm = readFormatEclMask(norm, size);
        if (fm.ecl >= 0 && fm.ecl <= 3) {
          drawStandardFinder(norm, size, pred.x - 3, pred.y - 3);
          drawFormatBitsAll(norm, size, fm.ecl, fm.mask);
        }
      } catch { /* 重建失败不致命，仍尝试解 */ }
      try {
        const r = decoder(norm, size, size);
        return { ok: true, inverted: det.inverted, isometry: nm,
                 missingCorner: pred.corner, result: r };
      } catch (e) { lastErr = e; }
    }
    return { ok: false, inverted: det.inverted, reason: "missing-corner normalized but decode failed",
             missingCorner: pred.corner, error: lastErr && lastErr.message };
  }

  return { ok: false, reason: "finder count < 2", finders: finders.length };
}
