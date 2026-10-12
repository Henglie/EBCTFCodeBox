/*
 * qrscanFind.js — 二维码「图片态」定位符检测（尺度无关）与三点仿射采样
 *
 * 纯函数、零 UI 依赖、零第三方依赖。
 *
 * 与模块态几何归一（qrgeom.js）的分工：qrgeom 处理**模块矩阵**上的几何归一（反色/旋转/
 * 镜像/缺角），本文件处理**像素位图**上的定位符搜索与采样 —— 两者互补不重叠。
 *
 * 为什么不复用 qrgeom.js 的定位符匹配：那里的窗口判定是**模块尺度**实现（中央段硬限
 * [2,6]、外侧段硬限 [1,3]，单位是"模块"）。像素位图上 pitch=4 时定位符中央暗核已有
 * 12 px，会被直接拒绝。故本文件实现**尺度无关**版本：只按比例判定（5 段总长 ≈ 7 单位），
 * 不含绝对长度上限，模块矩阵与像素位图通用。
 *
 * 权威依据：
 * - ISO/IEC 18004 §6.3.2：定位图案 7×7，其中心行/列为「暗:亮:暗:亮:暗 = 1:1:3:1:1」
 *   模块比例（总宽 7 模块）。比例判定天然尺度无关。
 * - ISO/IEC 18004 §6.3.2：定位图案外环暗 —— 用于区分 5×5 对齐图案与数据区伪命中。
 * - 三点仿射：QR 三个定位符圆心在符号坐标系中固定为模块中心 (3.5,3.5)、(n-3.5,3.5)、
 *   (3.5,n-3.5)，据此两个基向量即可把模块坐标映射到像素坐标，天然覆盖旋转/镜像/缩放。
 */

/** 单行游程：[{color, len, start}] */
export function rleLine(line) {
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

/**
 * 尺度无关的 1:1:3:1:1 窗判定。
 * 做法：五段总长应约等于 7 个「单位」；单位取 (总长/7)。要求
 *   外侧四段各落在 [0.5,1.6]×unit，中央段落在 [2,4]×unit。
 * 这些是**比例**约束，不含绝对长度上限 —— 因此模块矩阵与像素位图都能用。
 * 返回 {center, unit, lens} 或 null。
 */
export function matchWindowScaled(runs, s, finderColor, opt = {}) {
  const r0 = runs[s], r1 = runs[s + 1], r2 = runs[s + 2], r3 = runs[s + 3], r4 = runs[s + 4];
  if (!r0 || !r1 || !r2 || !r3 || !r4) return null;
  if (r0.color !== finderColor || r2.color !== finderColor || r4.color !== finderColor) return null;
  if (r1.color === finderColor || r3.color === finderColor) return null;
  const total = r0.len + r1.len + r2.len + r3.len + r4.len;
  if (total < 7) return null;                        // 至少 7 px 才能容下 7 模块
  const unit = total / 7;
  const lo = opt.lo == null ? 0.5 : opt.lo;
  const hi = opt.hi == null ? 1.6 : opt.hi;
  for (const r of [r0, r1, r3, r4]) {
    const k = r.len / unit;
    if (k < lo || k > hi) return null;
  }
  const kc = r2.len / unit;
  if (kc < 2 || kc > 4) return null;                 // 中央 3 模块，容差放宽到 [2,4]
  // 中央段必须是最长的（抑制时序区/数据区偶发同比例窗）
  if (!(r2.len > r0.len && r2.len > r1.len && r2.len > r3.len && r2.len > r4.len)) return null;
  // ⚠ 单位估计不能用 total/7：外侧黑环与相邻数据模块同色时会**合并**，
  //  使 total 偏大 → 单位高估 → 外环确认点落到 finder 之外被误拒。
  //  稳健做法取「各段折算成模块数后的最小值」：外侧四段各应 ~1 模块、中央 ~3 模块，
  //  合并只会让长度变大，故取最小对合并免疫。
  const unitRobust = Math.max(1, Math.min(r0.len, r1.len, r3.len, r4.len, r2.len / 3));
  return { center: r2.start + (r2.len >> 1), unit: unitRobust, unitShape: unit,
           lens: [r0.len, r1.len, r2.len, r3.len, r4.len] };
}

function findWindowRuns(runs, finderColor, opt) {
  const out = [];
  for (let s = 0; s + 5 <= runs.length; s++) {
    const m = matchWindowScaled(runs, s, finderColor, opt);
    if (m) out.push(m);
  }
  return out;
}

/**
 * 外环确认（射线法）：自中心沿四向在 [2.0, 4.0]×unit 区间内寻找连续同色段，
 * ≥3 个方向存在长度 ≥0.4 unit 的段即确认。
 *
 * 为什么不用「距中心 3×unit 处**单点**取点」：
 *   单点法对中心估计误差**零容错**。实测干净样图 demo3.jpg 里，真实 finder 的
 *   中心因聚类混入邻近伪命中而偏移约 1 个模块，单点法的四个取点全部落到环带
 *   内外侧（白环 / 静默区），真实 finder 被误拒，整图只确认 1 个 finder。
 *   射线法把容错放宽到约 ±1 unit，同时仍要求四向各自存在外环暗段。
 */
function ringConfirmed(bits, w, h, cx, cy, unit, finderColor) {
  const u = Math.max(1, unit);
  const t0 = Math.max(1, Math.round(2.0 * u));
  const t1 = Math.round(4.0 * u);
  const need = Math.max(1, Math.round(0.4 * u));
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  let hit = 0, inb = 0;
  for (const [dx, dy] of dirs) {
    let run = 0, best = 0, any = false;
    for (let t = t0; t <= t1; t++) {
      const x = Math.round(cx + dx * t), y = Math.round(cy + dy * t);
      if (x < 0 || x >= w || y < 0 || y >= h) break;
      any = true;
      if (bits[y * w + x] === finderColor) { run++; if (run > best) best = run; } else run = 0;
    }
    if (!any) continue;
    inb++;
    if (best >= need) hit++;
  }
  return inb >= 3 && hit >= 3;
}

/**
 * 像素级（尺度无关）定位符中心搜索。
 * 横向扫全图找 1:1:3:1:1 窗 → 竖向在同列复核 → 外环确认 → 去重。
 * 返回 [{x, y, unit}]，x/y 为像素坐标圆心，unit 为该窗估出的模块像素尺寸。
 */
export function findFinderCentersScaled(bits, w, h, finderColor = 1, opt = {}) {
  const raw = [];
  for (let y = 0; y < h; y++) {
    const row = new Array(w);
    for (let x = 0; x < w; x++) row[x] = bits[y * w + x];
    for (const m of findWindowRuns(rleLine(row), finderColor, opt)) {
      raw.push({ cx: m.center, cy: y, unit: m.unit });
    }
  }
  const out = [];
  for (const c of raw) {
    const col = new Array(h);
    for (let y = 0; y < h; y++) col[y] = bits[y * w + c.cx];
    const runs = rleLine(col);
    let bestU = 0, bestUShape = 0, bestCy = -1;
    for (let s = 0; s + 5 <= runs.length; s++) {
      const m = matchWindowScaled(runs, s, finderColor, opt);
      if (m && Math.abs(m.center - c.cy) <= Math.max(1, Math.round(m.unitShape || m.unit))) {
        bestU = m.unit; bestUShape = m.unitShape || m.unit; bestCy = m.center; break;
      }
    }
    if (bestCy < 0) continue;
    // 外环确认：两种单位估计（稳健最小值 / 形状 total/7）**任一**通过即确认 ——
    // 取并集，避免单一估法在「外侧黑环与数据区合并」或「细窄抗锯齿段」两种相反
    // 情形下各自误拒（迭代 3 用前者、迭代 2 用后者，各自都丢过真 finder）。
    const okRing = ringConfirmed(bits, w, h, c.cx, bestCy, bestU, finderColor)
                || ringConfirmed(bits, w, h, c.cx, bestCy, bestUShape, finderColor);
    if (!okRing) continue;
    // 去重：距离小于一个 finder 宽度（约 7 unit）视为同一 finder
    // ⚠ 下游 pitch 用**稳健估计** bestU（各段折算最小值），不用 unitShape（total/7）：
    //  total/7 在外侧黑环与相邻数据模块/静默区边界合并时系统性高估，
    //  会让版本被低估（n 偏小）、采样矩阵尺寸错位，整条解码必然失败。
    const u = bestU;
    const dup = out.find((o) => Math.abs(o.x - c.cx) <= 4 * o.unit + 2 && Math.abs(o.y - bestCy) <= 4 * o.unit + 2);
    if (dup) {
      if (u > dup.unit) { dup.x = c.cx; dup.y = bestCy; dup.unit = u; dup.unitShape = bestUShape; }
      continue;
    }
    out.push({ x: c.cx, y: bestCy, unit: u, unitShape: bestUShape });
  }
  return out;
}

/** 三点定位：返回 {TL, TR, BL, pitch} 或 null（pitch 为模块像素尺寸估计） */
export function orderThree(pts) {
  if (pts.length < 3) return null;
  // 取「两两距离之和最大」的三点组合（抗伪命中）；点少时直接全排列
  let best = null;
  const combos = [];
  for (let i = 0; i < pts.length; i++)
    for (let j = i + 1; j < pts.length; j++)
      for (let k = j + 1; k < pts.length; k++) combos.push([pts[i], pts[j], pts[k]]);
  for (const trio of combos) {
    // 找最长边（斜边）→ 其对顶点为 TL（直角顶点）
    const [a, b, c] = trio;
    const d = (p, q) => Math.hypot(p.x - q.x, p.y - q.y);
    const sides = [[d(b, c), a], [d(a, c), b], [d(a, b), c]].sort((x, y) => y[0] - x[0]);
    const hyp = sides[0][0];
    const tl = sides[0][1];
    const others = trio.filter((p) => p !== tl);
    // 直角条件（容差 25%）与等腰条件（容差 30%）
    const l1 = d(tl, others[0]), l2 = d(tl, others[1]);
    const rightErr = Math.abs((l1 * l1 + l2 * l2 - hyp * hyp) / (hyp * hyp));
    const isoErr = Math.abs(l1 - l2) / Math.max(l1, l2);
    if (rightErr > 0.25 || isoErr > 0.30) continue;
    const unit = (tl.unit + others[0].unit + others[1].unit) / 3;
    const score = hyp; // 取最大的合法三角（真正的三个 finder 跨度最大）
    if (!best || score > best.score) {
      best = { TL: tl, A: others[0], B: others[1], pitch: unit, hyp, score };
    }
  }
  if (!best) return null;
  // 两个待定点分别作 TR / BL（镜像时会对调，交由调用方两种都试）
  return { TL: best.TL, P1: best.A, P2: best.B, pitch: best.pitch, hyp: best.hyp };
}

/* ------------------------------------------------------------------ *
 * 采样自校准：用「采样矩阵里三个 finder 与标准 7×7 模板的一致度」评分，
 * 在 ±1 模块内微调三个 finder 中心。
 *
 * 为什么需要：
 *   finder 中心的像素级估计受 JPEG 缩放伪影/抗锯齿影响，实测干净样图
 *   demo3.jpg 的外环边界与中央核中心之间有约 0.5 模块的内部不自洽 —— 由
 *   1:1:3:1:1 窗推出的中心存在系统偏差，而三点仿射把这个偏差放大到整张
 *   网格（n=25 时末端累计可达 1 个模块），采样整体错位后解码必然失败。
 *   这里不依赖任何外部信息，直接优化「采样结果本身该有的样子」——
 *   QR 的三个 finder 是已知图案，是天然的校准基准（ISO/IEC 18004 §6.3.2）。
 * ------------------------------------------------------------------ */

/** 标准 7×7 定位图案（1=暗）：中心 3×3 与外圈暗，中间一圈亮 */
const FINDER7 = (() => {
  const m = [];
  for (let r = 0; r < 7; r++) {
    const row = [];
    for (let c = 0; c < 7; c++) {
      const d = Math.max(Math.abs(r - 3), Math.abs(c - 3));
      row.push(d <= 1 || d === 3 ? 1 : 0);
    }
    m.push(row);
  }
  return m;
})();

/** 采样矩阵里三个 finder 区域与标准模板的一致率（0..1） */
export function finderScore(mat, n) {
  if (!mat || n < 7) return -1;
  let s = 0, tot = 0;
  for (const [r0, c0] of [[0, 0], [0, n - 7], [n - 7, 0]]) {
    for (let r = 0; r < 7; r++) {
      for (let c = 0; c < 7; c++) {
        tot++;
        if (mat[r0 + r][c0 + c] === FINDER7[r][c]) s++;
      }
    }
  }
  return tot ? s / tot : -1;
}

/**
 * 以 finder 模板一致度为目标，对 trio 的三个中心做逐点贪心微调（单位：模块的分数步长）。
 * 返回 { trio, score }；score 为微调后的一致率。
 */
export function refineTrioByFinderScore(bits, w, h, trio, n, opt = {}) {
  const span = n - 7;
  if (span <= 0) return { trio, score: -1 };
  const dT = Math.hypot(trio.P1.x - trio.TL.x, trio.P1.y - trio.TL.y);
  const dL = Math.hypot(trio.P2.x - trio.TL.x, trio.P2.y - trio.TL.y);
  const pitch = Math.max(dT, dL) / span;
  const offs = opt.offs || [0, -0.5, 0.5, -1, 1];
  const keys = ["TL", "P1", "P2"];
  let best = { TL: { ...trio.TL }, P1: { ...trio.P1 }, P2: { ...trio.P2 } };
  const score = (t) => {
    const mat = sampleAffine(bits, w, h, t.TL, t.P1, t.P2, n, 0, 0);
    return mat ? finderScore(mat, n) : -1;
  };
  let cur = score(best);
  for (let pass = 0; pass < (opt.passes || 2); pass++) {
    for (const k of keys) {
      for (const dy of offs) {
        for (const dx of offs) {
          if (!dx && !dy) continue;
          const cand = { TL: { ...best.TL }, P1: { ...best.P1 }, P2: { ...best.P2 } };
          cand[k] = { x: best[k].x + dx * pitch, y: best[k].y + dy * pitch, unit: best[k].unit };
          const sc = score(cand);
          if (sc > cur + 1e-9) { best = cand; cur = sc; }
        }
      }
    }
  }
  return {
    trio: { TL: best.TL, P1: best.P1, P2: best.P2, pitch, hyp: trio.hyp },
    score: cur,
  };
}

/**
 * 三点仿射采样：
 *   TL 圆心在模块坐标 (3.5,3.5)，P1 为 TR、P2 为 BL（各在 (n-3.5,3.5)/(3.5,n-3.5)）
 *   X = (P1-TL)/(n-7)，Y = (P2-TL)/(n-7)
 *   模块 (r,c) 圆心像素 = TL + ((c+0.5)-3.5)*X + ((r+0.5)-3.5)*Y
 * 天然覆盖旋转 / 镜像 / 缩放 / 轻微剪切。
 */
export function sampleAffine(bits, w, h, TL, P1, P2, n, nx = 0, ny = 0) {
  const span = n - 7;
  if (span <= 0) return null;
  const Xx = (P1.x - TL.x) / span, Xy = (P1.y - TL.y) / span;
  const Yx = (P2.x - TL.x) / span, Yy = (P2.y - TL.y) / span;
  const mat = [];
  for (let r = 0; r < n; r++) {
    const row = new Array(n);
    for (let c = 0; c < n; c++) {
      const u = (c + 0.5) - 3.5, v = (r + 0.5) - 3.5;
      const px = TL.x + u * Xx + v * Yx;
      const py = TL.y + u * Xy + v * Yy;
      if (nx <= 0) {
        const x = Math.round(px), y = Math.round(py);
        row[c] = (x >= 0 && x < w && y >= 0 && y < h) ? bits[y * w + x] : 0;
      } else {
        let dark = 0, tot = 0;
        for (let dy = -ny; dy <= ny; dy++) {
          for (let dx = -nx; dx <= nx; dx++) {
            const x = Math.round(px) + dx, y = Math.round(py) + dy;
            if (x < 0 || x >= w || y < 0 || y >= h) continue;
            tot++; dark += bits[y * w + x] ? 1 : 0;
          }
        }
        row[c] = (tot && dark * 2 >= tot) ? 1 : 0;
      }
    }
    mat.push(row);
  }
  return mat;
}

/**
 * 由三 finder 生成候选（含 P1/P2 对调两解、以及按 pitch 推算的合法版本 n）。
 * 返回 [{n, pitch, matrix, swapped}]，已按 |hyp/(n-7) - unit| 排序、有界截断。
 */
export function candidatesFromFinders(bits, w, h, trio, opt = {}) {
  const maxN = 40; // 合法版本 1..40
  const LEGAL = new Set(Array.from({ length: maxN }, (_, i) => 21 + 4 * i));
  const out = [];
  const variants = [["P1P2", trio.P1, trio.P2], ["P2P1", trio.P2, trio.P1]];
  for (const [tag, TR, BL] of variants) {
    const hyp = Math.hypot(TR.x - BL.x, TR.y - BL.y);
    // ⚠ hyp 是 TL 的**对边（斜边）**：TL 与 TR、TL 与 BL 各隔 (n-7) 个模块，
    //  故 hyp = √2·(n-7)·pitch。估版本必须先除掉 √2，否则 n 被系统性低估
    //  （例：n=25、pitch=8.6 时 hyp≈219，漏 √2 会算出 n≈32）。
    const nHyp = Math.round(hyp / (trio.pitch * Math.SQRT2)) + 7;
    const ns = new Set();
    for (let d = -2; d <= 2; d++) if (LEGAL.has(nHyp + d)) ns.add(nHyp + d);
    // 另用两条边各推一次，增强鲁棒
    const dT = Math.hypot(TR.x - trio.TL.x, TR.y - trio.TL.y);
    const dL = Math.hypot(BL.x - trio.TL.x, BL.y - trio.TL.y);
    for (const dd of [dT, dL]) {
      const ne = Math.round(dd / trio.pitch) + 7;
      for (let d = -1; d <= 1; d++) if (LEGAL.has(ne + d)) ns.add(ne + d);
    }
    for (const n of ns) {
      const matPitch = Math.max(dT, dL) / (n - 7);
      const nb = matPitch >= 6 ? 1 : 0;
      const mat = sampleAffine(bits, w, h, trio.TL, TR, BL, n, nb, nb);
      if (!mat) continue;
      const defect = Math.abs(dT / (n - 7) - trio.pitch) / trio.pitch
                   + Math.abs(dL / (n - 7) - trio.pitch) / trio.pitch;
      // TL/TR/BL 一并回传：供下游做「对齐图案二阶网格校正」等需要原始三点的工作
      out.push({ n, pitch: matPitch, matrix: mat, swapped: tag, defect,
                 TL: trio.TL, TR, BL });
    }
  }
  out.sort((a, b) => a.defect - b.defect);
  return out.slice(0, opt.maxCand || 10);
}

/* ------------------------------------------------------------------ *
 * 双轴独立扫 + 聚类投票（替代「横向入口 → 竖向同列硬复核」）
 *
 * 为什么换：
 *   旧做法以**横向命中为唯一入口**，再要求**同一列**也能形成标准窗才确认。
 *   但 finder 的行与列穿越的邻域不同 —— 行可能正好与相邻数据模块合并而破窗，
 *   列却完好；反之亦然。实测干净样图 demo3.jpg 就是「横向只在左列成窗、纵向
 *   只在顶行成窗」，导致同一枚真 finder 在单方向被拒、在另一方向根本没进入
 *   候选，最终整图只确认 1 个 finder（需 3 个）。
 *
 * 做法：
 *   两个正交方向**各自独立**扫描并聚类，取并集后二次聚类合并；一个簇只要
 *   **任一方向**有足够支撑 + 外环确认通过即成立（投票式确认，而非串行硬复核）。
 * ------------------------------------------------------------------ */

/** 单方向扫描：返回原始命中 [{c, line, unit, unitShape}]（c 为沿该方向线的中心坐标） */
export function scanAxisHits(bits, w, h, axis, finderColor = 1, opt = {}) {
  const hits = [];
  const lines = axis === "row" ? h : w;
  const lineLen = axis === "row" ? w : h;
  const buf = new Array(lineLen);
  for (let li = 0; li < lines; li++) {
    for (let k = 0; k < lineLen; k++) buf[k] = axis === "row" ? bits[li * w + k] : bits[k * w + li];
    const runs = rleLine(buf);
    for (let s = 0; s + 5 <= runs.length; s++) {
      const m = matchWindowScaled(runs, s, finderColor, opt);
      if (m) hits.push({ c: m.center, line: li, unit: m.unit, unitShape: m.unitShape });
    }
  }
  return hits;
}

/** 中位数（不修改入参） */
function median(a) {
  if (!a.length) return 0;
  const b = a.slice().sort((p, q) => p - q);
  const m = b.length >> 1;
  return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2;
}

/** 单方向命中聚类（就近合并），返回 {x, y, unit, unitShape, support} */
export function clusterHits(hits, axis) {
  const cl = [];
  for (const hit of hits) {
    const x = axis === "row" ? hit.c : hit.line;
    const y = axis === "row" ? hit.line : hit.c;
    let best = null, bestD = Infinity;
    for (const k of cl) {
      const d = Math.hypot(median(k.xs) - x, median(k.ys) - y);
      const u = k.us.reduce((a, b) => a + b, 0) / k.us.length;
      // 半径 2.5×unit：同一 finder 的命中会散布在中心周围约 ±1.5 unit（中央带高 3 模块、
      // 加边缘行的轻微偏移），半径过小会把**同一枚 finder 拆成多个簇**，各簇中位数
      // 只反映部分行/列 → 中心偏移、进而击穿外环确认。真 finder 相邻间距 ≥14 unit，
      // 2.5 unit 不会造成跨 finder 误合并。
      if (d <= Math.max(3, 2.5 * u) && d < bestD) { best = k; bestD = d; }
    }
    // ⚠ 簇坐标用**中位数**而非均值：单个误合并的伪命中就能把均值拉偏约 1 模块，
    //  而中心偏移会直接击穿外环确认（见 ringConfirmed 注释）。中位数对离群免疫。
    if (best) {
      best.xs.push(x); best.ys.push(y);
      best.us.push(hit.unit); best.ss.push(hit.unitShape || hit.unit);
    } else {
      cl.push({ xs: [x], ys: [y], us: [hit.unit], ss: [hit.unitShape || hit.unit] });
    }
  }
  return cl.map((k) => ({
    x: median(k.xs), y: median(k.ys),
    unit: median(k.us), unitShape: median(k.ss), support: k.xs.length,
  }));
}

/**
 * 双轴独立扫 + 聚类投票的像素级定位符搜索。
 * 返回 [{x, y, unit, unitShape, support}]，按支撑度降序。
 */
export function findFinderCentersDual(bits, w, h, finderColor = 1, opt = {}) {
  const rowCl = clusterHits(scanAxisHits(bits, w, h, "row", finderColor, opt), "row");
  const colCl = clusterHits(scanAxisHits(bits, w, h, "col", finderColor, opt), "col");

  // 并集 + 二次聚类：同一 finder 可能只在单一方向成窗，故不能取交集
  const merged = [];
  const merge = (k, kind) => {
    let hit = null, bestD = Infinity;
    for (const m of merged) {
      const d = Math.hypot(m.x - k.x, m.y - k.y);
      if (d <= Math.max(3, 2.5 * Math.max(m.unit, k.unit)) && d < bestD) { hit = m; bestD = d; }
    }
    if (!hit) {
      merged.push({
        x: k.x, y: k.y, unit: k.unit, unitShape: k.unitShape, support: k.support,
        rb: kind === "row" ? k.support : 0, cb: kind === "col" ? k.support : 0,
      });
      return;
    }
    const a = hit.support, b = k.support, t = a + b;
    hit.x = (hit.x * a + k.x * b) / t;
    hit.y = (hit.y * a + k.y * b) / t;
    hit.unit = (hit.unit * a + k.unit * b) / t;
    hit.unitShape = (hit.unitShape * a + k.unitShape * b) / t;
    hit.support = t;
    if (kind === "row") hit.rb += k.support; else hit.cb += k.support;
  };
  for (const k of rowCl) merge(k, "row");
  for (const k of colCl) merge(k, "col");

  // 投票确认：支撑度达阈 + 外环确认（两种单位估计任一通过，沿用并集策略）
  const minSup = opt.minSupport == null ? 3 : opt.minSupport;
  const ok = [];
  for (const m of merged) {
    if (m.support < minSup) continue;
    const cx = Math.round(m.x), cy = Math.round(m.y);
    const rr = ringConfirmed(bits, w, h, cx, cy, m.unit, finderColor)
            || ringConfirmed(bits, w, h, cx, cy, m.unitShape, finderColor);
    if (rr) ok.push(m);
  }

  // 同一 QR 各 finder 的模块尺寸一致：以最强簇为基准剔除尺度明显不符者
  if (!ok.length) return [];
  ok.sort((a, b) => b.support - a.support);
  const u0 = ok[0].unit;
  const keep = ok.filter((m, i) => i === 0 || Math.abs(m.unit / u0 - 1) <= (opt.unitTol == null ? 0.5 : opt.unitTol));
  return keep.slice(0, opt.maxFinders || 8).map((m) => ({
    x: m.x, y: m.y, unit: m.unit, unitShape: m.unitShape, support: m.support,
  }));
}
