/*
 * qrFindless.js — 二维码「无定位符 / 定位符失效 / 遮挡」时的网格重建与解码入口
 *
 * 为什么需要这一层
 * ----------------
 * ISO/IEC 18004 §6.3.2 的定位图案（finder，7×7）是**功能图案**：它的取值由规范
 * 完全确定，**不承载任何数据**。因此「定位符被抹掉 / 被遮挡 / 被替换」损失的只是
 * **几何参照**，信息本身一个比特都没丢。但现用内核 `qrDecodeMatrix` 的入口要求
 * `countFinders(matrix) >= 3`，定位符一缺就在入口处抛错 —— 这与内核的真实前提
 * （合法尺寸 + 正确朝向 + 已知/可穷举的纠错级与掩码）并不等价。
 *
 * 本层把「定位符」从**前提**降级为**优选**，补三条通用能力：
 *   ① 网格重建 enumerateFindlessGrids：不依赖 1:1:3:1:1 检测，改由图像自身的
 *      尺度证据（整图=符号 / 稳健外接框 / 静默区模型 / 游程节距）推模块网格；
 *   ② 无定位符解码 decodeFindless：尺寸合法即可，朝向按二面体群 D4 八种等距变换
 *      枚举，纠错级+掩码未知时穷举 32 组，**逐组要求「重编码回同一码字流」**；
 *   ③ 墨色擦除 moduleInkConfidence：模块只有暗/亮两态，故「邻域内不属于任一墨色」
 *      的模块 = 非模块内容（遮挡/异色）⇒ 标为擦除位置，交给带擦除的 RS。
 *
 * 规范依据
 * --------
 * - ISO/IEC 18004 §6.3.2：定位图案 7×7，位于三角（左上/右上/左下），右下留空定向；
 *   取值固定（外环暗、次圈亮、中心 3×3 暗）⇒ 属功能图案、可无损重建。
 * - ISO/IEC 18004 §6.3.3：时序图案为第 6 行/第 6 列的「逐模块交替」，起止均暗；
 *   对齐图案 5×5（外圈暗、次圈亮、中心暗）。
 * - ISO/IEC 18004 §6.3.1：静默区为符号四周各 4 模块的亮区。
 * - ISO/IEC 18004 §6.9.1：格式信息 15 位 = 5 位数据 + BCH(15,5)（生成多项式 0x537）
 *   再与 0x5412 异或，两份副本；BCH 最小距离 7 ⇒ 可纠 3 位。
 * - ISO/IEC 18004 §6.5 + 附录 B：纠错容量 —— 每块可承受的擦除数上限为该块校验
 *   码字数 nsym（e + 2v ≤ nsym）。
 * - ISO/IEC 18004 附录 D/E：尺寸 size = 21 + 4k；各版本对齐图案中心坐标表。
 *
 * 不做什么
 * --------
 * - 不为任何单一样本写分支：`enumerateFindlessGrids` 的模型全是**声明式**的
 *   图像-符号尺度关系，声明之外的形态一律不猜（返回空）。
 * - 不把「检测到的伪定位符」反过来硬凑网格：伪定位符只会给出错网格。
 * - 不改变 `qrDecodeMatrix` 的既有契约（仍要求 3 个定位符）；本层是并列入口。
 */

import {
  buildFunctionMap, readCodewords, deinterleave, decodeDataSegments,
  ALIGNMENT_PATTERN_CENTERS,
} from "./qrdecode.js";
import { decodeWithErasures, reencodeMatches } from "./qrErasureDecode.js";
import { ISOMETRIES, applyIso, readFormatEclMask } from "./qrgeom.js";
import { LEGAL_SIZES, robustBBox, binarize } from "./qrscanSample.js";

const LEGAL = new Set(LEGAL_SIZES);
const ECL_NAMES = ["L", "M", "Q", "H"];

/**
 * 失败阶段归类（与 qrscan.js 的阶段口径一致）：把本层遇到的失败原因归到链路上的哪一步，
 * 供上层「诊断汇总」把「无定位符兜底走到了哪」也计入最深阶段，而不是一律显示「定位符不足」。
 */
export function findlessStage(e) {
  const m = String((e && e.reason) || (e && e.message) || e || "");
  if (/非 QR 合法|尺寸/.test(m)) return "grid";
  if (/超上限|弃用/.test(m)) return "erasure";
  if (/重编码/.test(m)) return "reencode";
  if (/歧义|文本不一致/.test(m)) return "ambiguous";
  if (/数据段/.test(m)) return "segment";
  if (/Chien|Λ|Forney|超出纠错能力|后验校正子|去交织|去掩码|擦除解码失败|全部失败|全部网格候选/.test(m)) return "rs";
  return "data";
}

// ============================================================
// 像素-模块坐标约定（全文件统一）
// 像素 i 覆盖连续区间 [i, i+1)，中心为 i+0.5；`ox/oy` = 符号（模块 0 左/上边界）
// 在连续坐标中的位置，`pitch` = 每模块像素数。故
//  模块 k 的中心像素索引 = round(ox + (k + 0.5) * pitch - 0.5)
// pitch 为整数时即模块区间正中；pitch = 1 时退化为 ox + k（不产生错位）。
// ============================================================
export function moduleCenterIndex(o, k, pitch) { return Math.round(o + (k + 0.5) * pitch - 0.5); }

/** ox/oy/pitch/n → 三个定位符圆心的像素索引（供 moduleInkConfidence 用） */
export function finderCentersOf(ox, oy, pitch, n) {
  return {
    TL: { x: ox + 3.5 * pitch - 0.5, y: oy + 3.5 * pitch - 0.5 },
    P1: { x: ox + (n - 3.5) * pitch - 0.5, y: oy + 3.5 * pitch - 0.5 },
    P2: { x: ox + 3.5 * pitch - 0.5, y: oy + (n - 3.5) * pitch - 0.5 },
  };
}

// ============================================================
// 墨色估计
// QR 模块只有「暗」「亮」两态（ISO/IEC 18004 §6.1）。图上实际出现的最深色即暗墨、
// 最浅色即亮墨（亮墨同时充当静默区底色）；两者之外的值只可能来自抗锯齿边缘（少数、
// 且只在模块边界）或遮挡/异色覆盖（成片）。这里只给墨色与容差，是否可信由逐模块判定。
// ============================================================
export function estimateInk(gray) {
  const hist = new Int32Array(256);
  for (let i = 0; i < gray.length; i++) hist[gray[i] & 255]++;
  let dark = -1, light = -1, levels = 0;
  for (let v = 0; v < 256; v++) if (hist[v]) { levels++; if (dark < 0) dark = v; light = v; }
  const tol = Math.max(4, Math.round((light - dark) * 0.15));
  let nDark = 0, nLight = 0, nOther = 0;
  for (let v = 0; v < 256; v++) {
    if (!hist[v]) continue;
    if (Math.abs(v - dark) <= tol) nDark += hist[v];
    else if (Math.abs(v - light) <= tol) nLight += hist[v];
    else nOther += hist[v];
  }
  const total = gray.length || 1;
  return { dark, light, tol, levels,
           darkShare: nDark / total, lightShare: nLight / total, otherShare: nOther / total };
}

/**
 * 逐模块墨色可信度 + 采样矩阵。
 * conf[r][c] = 1（邻域内属于任一墨色的像素占比 ≥ certFrac，模块可信）
 *            / 0.05（不可信 ⇒ 作为擦除位置）
 * matrix[r][c] = 邻域**均值**低于墨色中点则为 1（暗）。
 * 依据 ISO/IEC 18004 §6.1：模块只有暗/亮两态。
 *
 * ⚠ 取值与可信度必须分开判（实测踩过）：取值若用「纯墨像素多数票」（只数落在
 * ink.tol 内的像素），则**重采样 / 抗锯齿**后的图会整片判错——这类图存在大量中间
 * 灰度像素（实测某样本 24% 的像素既不在暗墨容差内、也不在亮墨容差内），它们既不
 * 计暗也不计亮，于是多数票在两侧都不成立、模块值随机翻向一侧，数据位大面积出错。
 * 故：**取值按邻域均值阈值判**（抗抗锯齿），**墨色纯度只用于可信度**（决定擦除位置）。
 */
export function moduleInkConfidence(gray, w, h, TL, P1, P2, n, opt = {}) {
  const nb = opt.nb == null ? 0 : opt.nb;
  const certFrac = opt.certFrac == null ? 0.6 : opt.certFrac;
  const ink = opt.ink || estimateInk(gray);
  const thr = (ink.dark + ink.light) / 2;
  const span = n - 7;
  const Xx = (P1.x - TL.x) / span, Xy = (P1.y - TL.y) / span;
  const Yx = (P2.x - TL.x) / span, Yy = (P2.y - TL.y) / span;
  const conf = [], matrix = [];
  for (let r = 0; r < n; r++) {
    const rc = new Array(n), rm = new Array(n);
    for (let c = 0; c < n; c++) {
      const u = (c + 0.5) - 3.5, v = (r + 0.5) - 3.5;
      const px = TL.x + u * Xx + v * Yx, py = TL.y + u * Xy + v * Yy;
      let cert = 0, tot = 0, sum = 0;
      for (let dy = -nb; dy <= nb; dy++) {
        for (let dx = -nb; dx <= nb; dx++) {
          const x = Math.round(px) + dx, y = Math.round(py) + dy;
          if (x < 0 || x >= w || y < 0 || y >= h) continue;
          tot++;
          const g = gray[y * w + x];
          sum += g;
          if (Math.abs(g - ink.dark) <= ink.tol || Math.abs(g - ink.light) <= ink.tol) cert++;
        }
      }
      rm[c] = (tot && sum / tot < thr) ? 1 : 0;
      rc[c] = (tot && cert / tot >= certFrac) ? 1 : 0.05;
    }
    conf.push(rc); matrix.push(rm);
  }
  return { conf, matrix };
}

// ============================================================
// 结构评分（均与定位符无关，故对「定位符被抹掉/被遮挡」的形态仍有效）
// ============================================================
/** 时序图案一致率（§6.3.3）。给 certain 时只在墨色可信模块上计分 */
export function timingScore(mat, n, certain) {
  if (!mat || n < 21) return -1;
  let s = 0, tot = 0;
  const ok = (r, c) => !certain || (certain[r] && certain[r][c] >= 1);
  for (let c = 8; c <= n - 9; c++) { if (!ok(6, c)) continue; tot++; if (mat[6][c] === (c % 2 === 0 ? 1 : 0)) s++; }
  for (let r = 8; r <= n - 9; r++) { if (!ok(r, 6)) continue; tot++; if (mat[r][6] === (r % 2 === 0 ? 1 : 0)) s++; }
  return tot >= 4 ? s / tot : -1;
}

/** 格式信息 BCH 硬判距（越小越像「格式区完好」） */
export function formatBchDist(mat, n) {
  const r = readFormatEclMask(mat, n);
  return { dist: r.dist, ecl: r.ecl, mask: r.mask };
}

/**
 * 廉价结构评分：只读时序行/列（2(n-7) 个模块）与格式区（30 个模块），
 * 不分配 n×n 矩阵 —— 用于在完整采样之前把上百个尺度候选筛到十几个。
 */
function cheapStruct(gray, w, h, c, ink) {
  const thr = (ink.dark + ink.light) / 2;
  const { ox, oy, pitch, n } = c;
  const bitAt = (r, k) => {
    const x = moduleCenterIndex(ox, k, pitch);
    const y = moduleCenterIndex(oy, r, pitch);
    if (x < 0 || x >= w || y < 0 || y >= h) return -1;
    return gray[y * w + x] < thr ? 1 : 0;
  };
  let s = 0, tot = 0;
  for (let k = 8; k <= n - 9; k++) { tot++; if (bitAt(6, k) === (k % 2 === 0 ? 1 : 0)) s++; }
  for (let r = 8; r <= n - 9; r++) { tot++; if (bitAt(r, 6) === (r % 2 === 0 ? 1 : 0)) s++; }
  const timing = tot ? s / tot : -1;
  // 格式区：复用 qrgeom 的规范坐标表（此处只填需要的 18 行，避免分配整张 n×n）
  const proxy = new Array(n);
  const rows = [0, 1, 2, 3, 4, 5, 6, 7, 8, n - 8, n - 7, n - 6, n - 5, n - 4, n - 3, n - 2, n - 1];
  for (const y of rows) if (y >= 0 && y < n) proxy[y] = new Array(n).fill(0);
  const pos1 = [[8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8], [7, 8],
                [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8]];
  const pos2 = [[n - 1, 8], [n - 2, 8], [n - 3, 8], [n - 4, 8], [n - 5, 8], [n - 6, 8], [n - 7, 8],
                [n - 8, 8], [8, n - 7], [8, n - 6], [8, n - 5], [8, n - 4], [8, n - 3], [8, n - 2], [8, n - 1]];
  for (const [x, y] of pos1.concat(pos2)) {
    if (proxy[y]) proxy[y][x] = bitAt(y, x) === 1 ? 1 : 0;
  }
  const fmt = formatBchDist(proxy, n);
  return { timing, fmt };
}

// ============================================================
// 网格重建（不依赖定位符检测）
// ============================================================
/** 由灰度图按 (ox,oy,pitch,n) 完整采样模块矩阵 + 墨色可信度 */
export function sampleGridAt(gray, w, h, ox, oy, pitch, n, nb = 0, ink, certFrac) {
  const fc = finderCentersOf(ox, oy, pitch, n);
  return moduleInkConfidence(gray, w, h, fc.TL, fc.P1, fc.P2, n,
    certFrac == null ? { nb, ink } : { nb, ink, certFrac });
}

/**
 * 声明式尺度模型 → 网格候选。
 *
 * 每个模型都是「图像像素尺度 ↔ 模块数」的**显式**关系（逐条声明、逐条受检）：
 *   exact  ：整图（或方形窗口）即符号本体，模块像素数为整数（边长能被 n 整除）
 *   bbox   ：暗像素稳健外接框（短边）即符号本体
 *   bboxQz ：外接框含 4 模块静默区（§6.3.1）
 *   fullQz ：整图含 4 模块静默区
 *   pitchRun：中央行/列游程众数给出模块像素尺寸，反推 n（两轴独立，不假设各向同性）
 *
 * 排序按「模型先验序 → 同模型内结构评分」：`exact` 的整数节距是最强先验
 * （不需要任何检测即可成立），故永远排最前先试。
 * 声明之外的形态一律不生成候选：非方形差异 > max(2px, 2%)、pitch < 1、越界。
 *
 * @param {ArrayLike<number>} gray 灰度（0..255，行主序）
 * @returns {{candidates:Array, notes:string[], total:number, ink:object}}
 */
export function enumerateFindlessGrids(gray, w, h, opt = {}) {
  const notes = [];
  const ink = opt.ink || estimateInk(gray);
  const bits = opt.bits || binarize(gray, w, h, "fixed", { threshold: Math.round((ink.dark + ink.light) / 2) }).bits;
  const raw = [];
  const seen = new Set();
  const push = (model, n, pitch, ox, oy, why) => {
    if (!LEGAL.has(n) || !(pitch >= 1)) return;
    if (ox + n * pitch > w + pitch || oy + n * pitch > h + pitch) return;
    const key = model + "@" + n + "@" + pitch.toFixed(3) + "@" + ox.toFixed(2) + "," + oy.toFixed(2);
    if (seen.has(key)) return;
    seen.add(key);
    raw.push({ model, n, pitch, ox, oy, why });
  };

  // 方形窗口集合（非方形时按短边取 4 极角 + 居中，容忍「多一行/多一列」装订余量）
  const sq = Math.min(w, h);
  const windows = [];
  if (w === h) windows.push([0, 0, w, h]);
  else if (Math.abs(w - h) <= Math.max(2, Math.round(sq * 0.02))) {
    const dx = w - sq, dy = h - sq;
    for (const [ox, oy] of [[0, 0], [dx, 0], [0, dy], [dx, dy], [dx >> 1, dy >> 1]]) {
      if (!windows.some((q) => q[0] === ox && q[1] === oy)) windows.push([ox, oy, sq, sq]);
    }
    notes.push(`图像非方形（${w}×${h}）差异 ≤2%：按短边 ${sq} 取 ${windows.length} 个方形窗口`);
  } else {
    notes.push(`图像非方形且差异 ${Math.abs(w - h)}px 过大，exact 模型不适用`);
  }

  // 模型 exact：整图/方形窗口 = 符号本体；整数节距优先、节距大者优先
  for (const [ox, oy, ww, hh] of windows) {
    const L = Math.min(ww, hh);
    const doses = [];
    for (const n of LEGAL_SIZES) {
      if (L % n !== 0) continue;
      const p = L / n;
      if (p >= 1) doses.push({ n, p, exactInt: true });
    }
    for (const n of LEGAL_SIZES) {
      const p = L / n;
      if (p < 1) continue;
      if (Math.abs(p - Math.round(p)) <= 0.06) doses.push({ n, p, exactInt: false });
    }
    doses.sort((a, b) => (a.exactInt === b.exactInt ? b.p - a.p : (a.exactInt ? -1 : 1)));
    for (const d of doses) push(d.exactInt ? "exact" : "exact~", d.n, d.p, ox, oy,
      d.exactInt ? "整图=符号本体，边长整除（整数节距）" : "整图=符号本体，节距近整数");
  }

  // 模型 bbox / bboxQz
  const bb = robustBBox(bits, w, h, opt.frac);
  if (bb) {
    const side = Math.min(bb.bw, bb.bh);
    for (const n of LEGAL_SIZES) {
      if (side / n >= 1) push("bbox", n, side / n, bb.x0, bb.y0, "稳健外接框（短边）=符号本体");
      const p2 = side / (n + 8);
      if (p2 >= 1) push("bboxQz", n, p2, bb.x0 + 4 * p2, bb.y0 + 4 * p2, "外接框含 4 模块静默区");
    }
  } else notes.push("稳健外接框为空（图面无明显暗区）");

  // 模型 fullQz
  for (const n of LEGAL_SIZES) {
    const p = Math.min(w, h) / (n + 8);
    if (p >= 1) push("fullQz", n, p, 4 * p, 4 * p, "整图含 4 模块静默区");
  }

  // 模型 pitchRun：中央行/列游程众数
  const pitchOf = (getter, len) => {
    const hist = new Int32Array(Math.max(2, Math.floor(len / 6)) + 2);
    let prev = getter(0), run = 1;
    for (let i = 1; i < len; i++) {
      const v = getter(i);
      if (v === prev) run++;
      else { if (run < hist.length) hist[run]++; prev = v; run = 1; }
    }
    if (run < hist.length) hist[run]++;
    let mode = 0, best = -1;
    for (let p = 1; p < hist.length; p++) if (hist[p] > best) { best = hist[p]; mode = p; }
    return mode;
  };
  const px = pitchOf((x) => bits[Math.floor(h / 2) * w + x], w);
  const py = pitchOf((y) => bits[y * w + Math.floor(w / 2)], h);
  notes.push(`游程节距众数：水平 ${px}px / 垂直 ${py}px`);
  if (bb) {
    for (const n of LEGAL_SIZES) {
      if (px >= 1 && bb.bw / n >= 1) push("pitchRunX", n, bb.bw / n, bb.x0, bb.y0, `水平节距 ${px} 反推 n`);
      if (py >= 1 && bb.bh / n >= 1) push("pitchRunY", n, bb.bh / n, bb.x0, bb.y0, `垂直节距 ${py} 反推 n`);
    }
  }

  // 廉价结构评分（时序 + 格式区）→ 每个模型留前 perModel 个（exact 全留）
  const prelim = raw.map((c) => {
    const s = cheapStruct(gray, w, h, c, ink);
    return { ...c, timing: s.timing, fmt: s.fmt,
             score: (s.timing < 0 ? -3 : s.timing) - s.fmt.dist * 0.05 };
  });
  const PRI = { exact: 0, "exact~": 1, bbox: 2, bboxQz: 3, pitchRunX: 4, pitchRunY: 5, fullQz: 6 };
  const cmp = (a, b) => {
    const pa = PRI[a.model] - PRI[b.model];
    if (pa) return pa;
    if (b.score !== a.score) return b.score - a.score;
    return b.pitch - a.pitch;
  };
  prelim.sort(cmp);
  const perModel = opt.perModel == null ? 3 : opt.perModel;
  const used = new Map();
  const kept = [];
  for (const c of prelim) {
    const u = used.get(c.model) || 0;
    if (c.model !== "exact" && u >= perModel) continue;
    used.set(c.model, u + 1);
    kept.push(c);
    if (kept.length >= (opt.maxCand || 20)) break;
  }

  // 完整采样（仅对筛后的候选）
  const candidates = [];
  for (const c of kept) {
    const s = sampleGridAt(gray, w, h, c.ox, c.oy, c.pitch, c.n, c.pitch >= 6 ? 1 : 0, ink, opt.certFrac);
    let erased = 0;
    for (let r = 0; r < c.n; r++) for (let k = 0; k < c.n; k++) if (s.conf[r][k] < 1) erased++;
    const t = timingScore(s.matrix, c.n, s.conf);
    const f = formatBchDist(s.matrix, c.n);
    candidates.push({ ...c, matrix: s.matrix, conf: s.conf, timing: t, fmt: f,
                      erasedRatio: erased / (c.n * c.n),
                      score: (t < 0 ? -3 : t) - f.dist * 0.05 });
  }
  candidates.sort((a, b) => {
    const pa = PRI[a.model] - PRI[b.model];
    if (pa) return pa;
    if (b.score !== a.score) return b.score - a.score;
    return b.pitch - a.pitch;
  });
  return { candidates, notes, total: prelim.length, ink };
}

// ============================================================
// 功能图案重建：ISO/IEC 18004 §6.3.2/§6.3.3 + 附录 E
// 给定 (n, 朝向)，功能图案取值完全确定 ⇒ 可无损写回。
// 用途：「定位符/时序/对齐被遮挡或涂改」时把已知部分复位，只留数据区待解。
// ============================================================
export function restoreFunctionPatterns(matrix, n) {
  if (!matrix || matrix.length !== n) return null;
  const version = (n - 17) / 4;
  if (!Number.isInteger(version) || version < 1 || version > 40) return null;
  const out = matrix.map((row) => row.slice());
  const set = (x, y, v) => { if (x >= 0 && x < n && y >= 0 && y < n) out[y][x] = v ? 1 : 0; };
  for (const [ox, oy] of [[0, 0], [n - 7, 0], [0, n - 7]]) {
    for (let dy = -1; dy <= 7; dy++) {
      for (let dx = -1; dx <= 7; dx++) {
        const x = ox + dx, y = oy + dy;
        if (x < 0 || x >= n || y < 0 || y >= n) continue;
        if (dx >= 0 && dx <= 6 && dy >= 0 && dy <= 6) {
          const d = Math.max(Math.abs(dx - 3), Math.abs(dy - 3));
          set(x, y, (d !== 2 && d !== 4) ? 1 : 0);
        } else set(x, y, 0);
      }
    }
  }
  for (let i = 8; i <= n - 9; i++) { set(i, 6, i % 2 === 0 ? 1 : 0); set(6, i, i % 2 === 0 ? 1 : 0); }
  const centers = ALIGNMENT_PATTERN_CENTERS[version];
  if (centers) {
    const last = centers[centers.length - 1];
    for (const cy of centers) {
      for (const cx of centers) {
        if ((cx === 6 && cy === 6) || (cx === 6 && cy === last) || (cx === last && cy === 6)) continue;
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            const d = Math.max(Math.abs(dx), Math.abs(dy));
            set(cx + dx, cy + dy, (d === 2 || d === 0) ? 1 : 0);
          }
        }
      }
    }
  }
  set(8, n - 8, 1);
  return out;
}

// ============================================================
// 无定位符解码入口
// 前提只有三条（与内核真实需求一致）：尺寸合法、朝向正确、纠错级+掩码已知或可穷举。
// 朝向未知 ⇒ D4 八种等距变换枚举（符号为正方形，D4 即全部朝向）；
// ECL/掩码未知 ⇒ 32 组穷举，**逐组要求重编码回同一码字流**（编码是确定性的：
// 同一 (文本, 版本, ECL, 掩码) 只有唯一码字流，该判据可彻底排除假成功）。
// ============================================================
export function decodeFindless(matrix, n, opt = {}) {
  const version = (n - 17) / 4;
  if (!Number.isInteger(version) || version < 1 || version > 40) {
    return { ok: false, reason: `尺寸 ${n} 非 QR 合法（21+4k）` };
  }
  const deadline = opt.deadline || (Date.now() + (opt.budget == null ? 8000 : opt.budget));
  const restored = opt.restore === false ? matrix : (restoreFunctionPatterns(matrix, n) || matrix);
  const isos = opt.isos || ISOMETRIES.map((i) => i.name);
  const hits = [], tried = [];
  for (const name of isos) {
    if (Date.now() > deadline) { tried.push({ iso: name, reason: "预算耗尽" }); break; }
    const iso = ISOMETRIES.find((i) => i.name === name);
    if (!iso) continue;
    const m = name === "none" ? restored : applyIso(restored, n, iso);
    const fm = readFormatEclMask(m, n);
    const combos = [];
    if (fm && fm.ecl >= 0 && fm.ecl <= 3) combos.push([fm.ecl, fm.mask]);
    for (let e = 0; e < 4; e++) for (let k = 0; k < 8; k++) {
      if (!combos.some((q) => q[0] === e && q[1] === k)) combos.push([e, k]);
    }
    let reason = "";
    for (const [ecl, mask] of combos) {
      const r = decodeWithErasures(m, opt.conf || null, n, version, ecl, mask, { requireReencode: false });
      if (!r.ok) { reason = r.reason; continue; }
      if (opt.requireReencode !== false && !reencodeMatches(r.correctedAll, r.text, n, version, ecl, mask)) {
        reason = "重编码码字流不一致（判为假成功）";
        continue;
      }
      hits.push({ iso: name, ecl, mask, text: r.text, errorCount: r.errorCount,
                  erasureCount: r.erasureCount, fmtDist: fm ? fm.dist : null });
      break;
    }
    if (!hits.length) tried.push({ iso: name, reason });
  }
  if (!hits.length) return { ok: false, reason: "八种朝向 × 32 组(ECL,掩码) 全部失败", tried };
  const texts = new Set(hits.map((x) => x.text));
  if (texts.size > 1) {
    return { ok: false, ambiguous: true, reason: `多朝向成功且文本不一致（${hits.length} 解）`,
             candidates: hits.map((x) => ({ iso: x.iso, ecl: x.ecl, mask: x.mask, text: x.text })) };
  }
  return { ok: true, consistent: hits.length > 1, ...hits[0], version, size: n, tried };
}

/**
 * 端到端：灰度图 → 网格候选 → 无定位符解码（含墨色擦除）。
 * 逐个候选试解并全程留痕，供诊断汇总用；总时长受 `opt.budgetMs` 约束。
 */
export function decodeFindlessFromGray(gray, w, h, opt = {}) {
  const t0 = Date.now();
  const budget = opt.budgetMs == null ? 6000 : opt.budgetMs;
  const deadline = t0 + budget;
  // **两遍结构**：第一遍按原顺序扫全部基础候选，第二遍才对最高分的 K 个做相位细化。
  // 为什么必须分两遍（实测踩过）：若把相位展开夹在候选之间，排在最前的两个候选（常常是
  // 尺度错的 exact 模型）各展开 24×2 次解码，会把预算耗光，真正正确的候选（如
  // bbox n=25 p=8.0）根本轮不到 —— 合成回归样本因此由「可解」变「不可解」。
  // 故给第一遍留 60% 预算，保证既有行为不被新增搜索挤掉。
  const baseDeadline = t0 + Math.max(300, Math.floor(budget * 0.6));
  const gp = enumerateFindlessGrids(gray, w, h, opt);
  const attempts = [];
  let stage = "grid";

  const record = (c, r, st) => attempts.push({
    model: c.model + (c.phased ? "·相位" : ""), n: c.n, pitch: c.pitch, ox: c.ox, oy: c.oy,
    why: c.why, timing: c.timing, fmtDist: c.fmt.dist, erasedRatio: c.erasedRatio,
    ok: !!r.ok, iso: r.iso, ecl: r.ecl, mask: r.mask, text: r.text,
    reason: r.reason || "", stage: st,
  });

  // ---- 第一遍：基础候选（顺序与未加相位搜索时完全一致）----
  for (const c of gp.candidates) {
    if (Date.now() > baseDeadline) { attempts.push({ model: c.model, n: c.n, reason: "预算耗尽（基础扫描）", stage: "grid" }); break; }
    const r = decodeFindless(c.matrix, c.n, { ...opt, conf: c.conf, deadline: baseDeadline });
    const st = r.ok ? "done" : findlessStage({ reason: r.reason });
    if (st !== "done" && st !== "grid" && (stage === "grid" || st === "reencode" || st === "erasure")) stage = st;
    record(c, r, st);
    if (r.ok) return { ok: true, ...r, grid: c, notes: gp.notes, attempts, ink: gp.ink, stage: "done" };
  }

  // ---- 第二遍：有界原点相位微调（±R px，**0.5px 步长**）----
  // 为什么必须做：几何模型只给**一个整数原点**，而模块边界未必落在整数像素上
  // （例：边长 264 / 21 = 12.5714px/模块）。原点取整差 ±1px，部分模块的采样点就落到
  // 边缘、取到错 bit ⇒ 整条 RS 失败。
  // 为什么必须按 **0.5px** 而非 1px 步长：采样取整用的是 `round(o + (k+0.5)p - 0.5)`
  // = `floor(o + (k+0.5)p)`，即「取包含模块中心的像素」。当真实原点落在半像素处时，
  // 只有半整数原点才能命中正确的像素序列；实测同一 264×264 符号在**全部整数原点**
  // （0..24 全扫 625 个）上无一可解，而 (6.5,12.5) 一次命中。
  // 为什么不用廉价评分预筛相位：实测该评分（时序 + 格式距）在**错误**相位上会饱和
  // （时序满分、格式距并列），对 ±0.5px 不敏感 ⇒ 唯一可信的判据是**真实解码**
  // （RS + 重编码校验）。代价受 K×((2R·2+1)²−1)×|NBS| 与剩余预算双重约束。
  const PHASE_K = opt.phaseK == null ? 3 : opt.phaseK;
  const PHASE_R = opt.phaseR == null ? 1 : opt.phaseR;
  // 邻域也一起搜：nb=1（3×3 均值）对噪声更稳，但**抗锯齿/重采样**图上均值会被邻居
  // 带偏、翻掉个别模块；nb=0（单像素）此时才是准的。两者互补，故都试。
  const PHASE_NBS = opt.phaseNbs || [1, 0];
  const sampleAtPhase = (c, ox, oy, nb) => {
    const s = sampleGridAt(gray, w, h, ox, oy, c.pitch, c.n, nb, gp.ink, opt.certFrac);
    let erased = 0;
    for (let r = 0; r < c.n; r++) for (let k = 0; k < c.n; k++) if (s.conf[r][k] < 1) erased++;
    const t = timingScore(s.matrix, c.n, s.conf);
    const f = formatBchDist(s.matrix, c.n);
    return { ...c, ox, oy, nb, matrix: s.matrix, conf: s.conf, timing: t, fmt: f, phased: true,
             erasedRatio: erased / (c.n * c.n), score: (t < 0 ? -3 : t) - f.dist * 0.05 };
  };

  const phaseTargets = gp.candidates.slice(0, Math.max(0, PHASE_K));
  for (const c of phaseTargets) {
    let phasedHit = false;
    for (let iy = -2 * PHASE_R; iy <= 2 * PHASE_R && !phasedHit; iy++) {
      for (let ix = -2 * PHASE_R; ix <= 2 * PHASE_R && !phasedHit; ix++) {
        if (!ix && !iy) continue;
        const ox = c.ox + ix * 0.5, oy = c.oy + iy * 0.5;
        if (ox < 0 || oy < 0) continue;
        if (ox + c.n * c.pitch > w + c.pitch || oy + c.n * c.pitch > h + c.pitch) continue;
        for (const nb of PHASE_NBS) {
          if (Date.now() > deadline) break;
          const pc = sampleAtPhase(c, ox, oy, nb);
          const pr = decodeFindless(pc.matrix, pc.n, { ...opt, conf: pc.conf, deadline });
          record(pc, pr, pr.ok ? "done" : findlessStage({ reason: pr.reason }));
          if (pr.ok) {
            phasedHit = true;
            return { ok: true, ...pr, grid: pc, notes: gp.notes, attempts, ink: gp.ink, stage: "done" };
          }
        }
      }
    }
  }
  return { ok: false, reason: "全部网格候选 × 全部朝向/纠错级/掩码组合均失败", stage,
           notes: gp.notes, ink: gp.ink, candidateCount: gp.total, attempts };
}

/** 便利：由 0/1 位图直接解（无灰度时按 0/255 合成灰度，遮挡判定自然失效） */
export function decodeFindlessFromBits(bits, w, h, opt = {}) {
  const gray = opt.gray || (() => { const g = new Array(w * h); for (let i = 0; i < g.length; i++) g[i] = bits[i] ? 0 : 255; return g; })();
  return decodeFindlessFromGray(gray, w, h, { ...opt, bits });
}

export { LEGAL_SIZES, ECL_NAMES };
export const _internal = { buildFunctionMap, readCodewords, deinterleave, decodeDataSegments, cheapStruct };