/*
 * stegdetect.js — JPEG 隐写检测（cat:'analysis'，run 型单向分析）。
 *
 * 做什么：对一张 JPEG 统计 DCT 系数分布，跑 chi-square 卡方攻击（Westfeld/Pfitzmann），
 * 叠加 jsteg（顺序 LSB）与 F5（直方图收缩）两类特征启发式，输出「检出/未检出」结论
 * + 各项统计（卡方 p 值 / 累计曲线 / 分块分布 / 直方特征）供人工复核。
 *
 * ---- 算法来源与忠实度声明（红线：算法不许编造） ----
 * 1. chi-square 攻击：Westfeld & Pfitzmann, "Attacks on Steganographic Systems"
 *    (Information Hiding Workshop 1999)。口径照论文：
 *    · PoV（pair of values）对 = (2i, 2i+1)，i 从 1 起（论文公式 Σ_{i=1}^{k}，
 *      即排除 (0,1) 对——该对不含 LSB 嵌入信息且 h(0) 占比悬殊）；
 *    · 期望 n(i) = (h(2i)+h(2i+1))/2；
 *    · χ² = Σ (h(2i) − n(i))² / n(i)，自由度 = 有效对数 − 1（n(i)>0 的对）；
 *    · p 值 = 卡方上侧概率 Q(df/2, χ²/2)（正则化不完全 Gamma，NR 数值口径）。
 *      p 大 ⇒ (2i,2i+1) 计数趋平 ⇒ 疑似 LSB 类嵌入；p 小 ⇒ 干净。
 *    · 直方图取幅度 |c|（正负号折叠）：LSB 族的翻转都「保号、改 |c| 奇偶」——
 *      jsteg 用补码 LSB（c&1=|c|&1），翻转走 2↔3、−2↔−3；F5 用符号-幅值 LSB
 *      （c<0 取反），收缩走 |c|→|c|−1。两者的 PoV 结构都落在幅度对 (2i,2i+1)
 *      内，故按论文公式对幅度直方图统计即覆盖正负两侧。
 * 2. jsteg 特征：jsteg（D. Upham）为顺序 LSB 替换，规范规则为幅值语义的
 *    「值对内翻转」——跳过 |c|≤1，|c| 偶→+1、|c| 奇→−1、符号不变（2↔3、4↔5…），
 *    嵌入后 PoV 对内计数趋平；顺序嵌导致「嵌入区域连续」——累计卡方曲线前段
 *    p 高、payload 耗尽后跌落。据此给顺序特征（顺序嵌入的整体 p 会被未嵌入区
 *    稀释，故顺序特征是独立检出路径，不以整体 p 为前提）。
 * 3. F5 特征：F5（Westfeld）嵌入对非零系数做 |c|−1 递减、±1 收缩跳到反号
 *    （histogram shrinking）。递减结构天然把 h(2i) 拉向对均值——高填充率下
 *    χ² 才会抬头；中低填充率（尤其带矩阵编码的真 F5）是 χ² 已知盲区。收缩
 *    指标（r12、r23）仅作直方特征输出供人工复核：实测干净图自然直方的
 *    r12/r23 也能超过 2（无封面校准不可靠），故不参与强判定、不单独成检。
 *
 * ---- 定位声明 ----
 * 原版 stegdetect（Niels Provos, C 实现）是多种统计 + 训练校准的检测器；本文件
 * 是「近似实现」：只覆盖 chi-square 攻击 + 两类启发式特征，不复制原版代码，
 * 不追分数（对拍口径=「检出/不检出」一致）。输出明确标注近似，结论一律带「疑似」。
 *
 * 复用：JPEG 解析直接 import f5stego.js 的 parseJpeg（勿重写解析器）。
 * 红线遵守：纯前端零外发；件内自注册；报告无 emoji（● ✓ ▸ × ✗ ⚠）。
 */
import { register } from "./registry.js";
import { parseJpeg, parseInput, pickComponent } from "./f5stego.js";
import { analyzeScans } from "./jpegRewrite.js";

function decodeOrderBlocks(comps, frame, interleaved) {
  const out = new Int16Array(comps.reduce((n, c) => n + c.blocks.length, 0));
  let offset = 0;
  if (!interleaved) {
    for (const c of comps) { out.set(c.blocks, offset); offset += c.blocks.length; }
    return out;
  }
  for (let y = 0; y < frame.mcusPerColumn; y++) for (let x = 0; x < frame.mcusPerLine; x++) {
    for (const c of comps) for (let j = 0; j < c.v; j++) for (let k = 0; k < c.h; k++) {
      const tile = ((y * c.v + j) * c.blocksPerLineForMcu + x * c.h + k) * 64;
      out.set(c.blocks.subarray(tile, tile + 64), offset);
      offset += 64;
    }
  }
  return out;
}

// ============================================================
// 卡方上侧概率 Q(df/2, x/2)——正则化不完全 Gamma（Numerical Recipes 口径）
// ============================================================
function _lgamma(x) {
 // Lanczos g=7
  const C = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - _lgamma(1 - x);
  x -= 1;
  let a = C[0];
  const t = x + 7.5;
  for (let i = 1; i < 9; i++) a += C[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

function _gser(a, x) {
 // 级数求 P(a,x)
  let ap = a, sum = 1 / a, del = sum;
  for (let n = 1; n < 500; n++) {
    ap++;
    del *= x / ap;
    sum += del;
    if (Math.abs(del) < Math.abs(sum) * 1e-14) break;
  }
  return sum * Math.exp(-x + a * Math.log(x) - _lgamma(a));
}

function _gcf(a, x) {
 // Lentz 连分式求 Q(a,x)
  const FPMIN = 1e-300;
  let b = x + 1 - a, c = 1 / FPMIN, d = 1 / b, h = d;
  for (let i = 1; i < 500; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = b + an / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-14) break;
  }
  return Math.exp(-x + a * Math.log(x) - _lgamma(a)) * h;
}

/** 卡方分布上侧概率（生存函数）。p 大 = 观测与「干净」假设吻合。 */
function chi2SF(chi2, df) {
  if (!(chi2 >= 0) || !(df >= 1)) return NaN;
  if (chi2 === 0) return 1;
  const a = df / 2, x = chi2 / 2;
  return x < a + 1 ? 1 - _gser(a, x) : _gcf(a, x);
}

// ============================================================
// 直方图 + chi-square 核心（论文口径：i 从 1 起，m = 映射值 0..255）
// ============================================================
const MAP_MAX = 255; // |c|>127 的系数极少，截断合并到 255

/** 单个 DCT 系数 → PoV 映射值 m：取幅度 |c|（保号翻转只改奇偶，见文件头口径说明）。 */
function mapCoeff(c) {
  const m = c >= 0 ? c : -c;
  return m <= MAP_MAX ? m : MAP_MAX;
}

/**
 * 从映射直方图算 chi-square（只统计 i>=1 的对，n(i)>0）。
 * 返回 { chi2, pairs, df, p }。
 */
function chiSquareFromHist(hist) {
  let chi2 = 0, pairs = 0;
  for (let i = 1; i < 128; i++) {
    const a = hist[2 * i], b = hist[2 * i + 1];
    const n = (a + b) / 2;
    if (n > 0) {
      const d = a - n;
      chi2 += (d * d) / n;
      pairs++;
    }
  }
  if (pairs < 2) return { chi2, pairs, df: 1, p: 0 };
  return { chi2, pairs, df: pairs - 1, p: chi2SF(chi2, pairs - 1) };
}

/**
 * 累计卡方曲线：按系数数组顺序扫一遍，在每个比例断点用「从头累计」直方图算 p。
 * （经典 Westfeld 攻击即对文件渐增部分做攻击，看 p 在何处跌落。）
 * blocks 为 Int16Array（长度=64 整数倍），i%64==0 的 DC 位跳过。
 */
function cumulativeChi2(blocks, fractions) {
  const hist = new Int32Array(256);
  const nBlocks = (blocks.length / 64) | 0;
  const curve = [];
  let idx = 0;
  for (let f = 0; f < fractions.length; f++) {
    let upto = Math.round(nBlocks * fractions[f]) * 64;
    if (upto > blocks.length) upto = blocks.length;
    if (upto < 64) upto = Math.min(64, blocks.length);
    for (; idx < upto; idx++) {
      if (idx % 64 === 0) continue; // DC 位恒 0，不入统计
      const c = blocks[idx];
      hist[mapCoeff(c)]++;
    }
    curve.push({ frac: fractions[f], ...chiSquareFromHist(hist) });
  }
  return curve;
}

/** 非累计分块：把块均分成 chunks 段，每段单独算 p（看嵌入区域连续性）。 */
function chunkedChi2(blocks, chunks) {
  const nBlocks = (blocks.length / 64) | 0;
  const out = [];
  for (let ci = 0; ci < chunks; ci++) {
    const from = Math.round((nBlocks * ci) / chunks) * 64;
    const to = Math.round((nBlocks * (ci + 1)) / chunks) * 64;
    const hist = new Int32Array(256);
    for (let idx = from; idx < to; idx++) {
      if (idx % 64 === 0) continue;
      hist[mapCoeff(blocks[idx])]++;
    }
    out.push(chiSquareFromHist(hist));
  }
  return out;
}

// ============================================================
// 特征指标
// ============================================================

/**
 * F5 收缩指标：r12 = H(|1|)/H(|2|)，r23 = H(|2|)/H(|3|)（幅度直方图，正负已折叠）。
 * 干净图两比值接近（都由同一衰减律支配）；F5 收缩把 ±2 压向 ±1，r12 相对 r23 抬升。
 */
function shrinkMetrics(hist) {
  const H1 = hist[1], H2 = hist[2], H3 = hist[3], H4 = hist[4];
  return {
    H1, H2, H3, H4,
    r12: H2 > 0 ? H1 / H2 : NaN,
    r23: H3 > 0 ? H2 / H3 : NaN,
    r34: H4 > 0 ? H3 / H4 : NaN,
  };
}

/** 从累计曲线找「顺序嵌入」特征：p 持续（≥2 个连续步长）≥ 阈值、后段跌落 ⇒ 嵌入区域连续。 */
function seqSignature(curve, threshold) {
  let runStart = -1, highEnd = -1;
  for (let i = 0; i < curve.length; i++) {
    if (curve[i].p >= threshold) {
      if (runStart < 0) runStart = i;
      if (i - runStart >= 1) highEnd = i; // 至少连续 2 点
    } else {
      runStart = -1;
    }
  }
  if (highEnd < 0) return { seq: false };
  const lastP = curve[curve.length - 1].p;
  // 高 p 段未到末尾且末段明显跌落 → 顺序嵌入特征
  if (highEnd < curve.length - 2 && lastP < threshold / 3) {
    return { seq: true, uptoFrac: curve[highEnd].frac, lastP };
  }
  return { seq: false, highP: curve[highEnd].p };
}

// ============================================================
// 报告小工具
// ============================================================
function fmt(x, d) {
  if (x === null || x === undefined || Number.isNaN(x)) return "—";
  return Number(x).toFixed(d === undefined ? 4 : d);
}
function pct(x, d) {
  if (!Number.isFinite(x)) return "—";
  return (x * 100).toFixed(d === undefined ? 2 : d) + "%";
}
function fmtRows(pairs) {
  return pairs.map(([k, v]) => `  ${k}: ${v}`).join("\n");
}

// ============================================================
// run 主入口
// ============================================================
function stegdetectRun(text, p) {
  const compMode = p && p.comp === "all" ? "all" : "y";
  const sens = p && p.sens ? String(p.sens) : "std";
 // 判「检出」的 p 阈值：宽松=更容易判出；严格=更少误报
  const T = sens === "loose" ? 0.2 : sens === "strict" ? 0.8 : 0.5;
  const SHRINK_K = 1.8; // r12 > K*r23 视为收缩可疑（启发式，见文件头声明）

  const L = [];
  L.push("=== stegdetect JPEG 隐写检测（近似实现） ===");
  L.push("");

 // ---- 取字节：优先 rawBytes（acceptsBytes 拖入），否则 hex/base64/dataURL 文本 ----
  let bytes;
  if (p && p.rawBytes && p.rawBytes.length) {
    bytes = p.rawBytes instanceof Uint8Array ? p.rawBytes : new Uint8Array(p.rawBytes);
  } else {
    try {
      bytes = parseInput(text, "auto");
    } catch (e) {
      L.push("✗ 输入解析失败: " + (e.message || String(e)));
      L.push("  提示：拖入 JPEG 文件，或粘贴其 hex / base64 / dataURL。");
      return L.join("\n");
    }
  }
  if (!bytes || bytes.length === 0) {
    L.push("✗ 输入为空。请拖入 JPEG 文件，或粘贴其 hex / base64 / dataURL。");
    return L.join("\n");
  }
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    L.push(`⚠ 未见 JPEG SOI(FF D8) 头（首字节 ${bytes[0].toString(16).padStart(2, "0")} ${(bytes[1] || 0).toString(16).padStart(2, "0")}）——可能非 JPEG，仍尝试解析。`);
  }

 // ---- 解 JPEG（复用 f5stego.js 的 parseJpeg） ----
  let jpeg;
  try {
    jpeg = parseJpeg(bytes);
  } catch (e) {
    L.push("✗ JPEG 解析失败: " + (e.message || String(e)));
    L.push("  可能是：非 JPEG / 渐进式等罕见特性 / 文件损坏。");
    return L.join("\n");
  }
  const fr = jpeg.frame;

  L.push("--- JPEG 结构 ---");
  L.push(`● 尺寸: ${fr.samplesPerLine} × ${fr.scanLines}  类型: ${fr.progressive ? "渐进式 Progressive" : fr.extended ? "扩展 Extended" : "基线 Baseline"}  分量数: ${fr.components.length}`);
  if (jpeg.tail && jpeg.tail.length) {
    L.push(`● ⚠ EOI 后附加数据(tail): ${jpeg.tail.length} 字节——与 DCT 隐写无关，但可能另藏文件（先去查 binwalk/十六进制）。`);
  }
  L.push("");

 // ---- 取分析分量与系数 ----
  const comps = compMode === "all" ? fr.components : [pickComponent(fr)];
  // The SOS component list determines scan order, not the SOF component count.
  let interleavedScan = false;
  try {
    const scan = analyzeScans(jpeg);
    interleavedScan = !fr.progressive && scan.comps.length >= 2 && !scan.multiScan;
  } catch { /* Unknown scan layout keeps the existing storage order. */ }
  const blocks = decodeOrderBlocks(comps, fr, interleavedScan);

  const nBlocks = (blocks.length / 64) | 0;
  const compDesc = comps.map((c) => `id=${c.componentId}`).join(",");
  L.push("--- 分析范围 ---");
  L.push(`● 分量: ${compMode === "all" ? "全部分量" : "仅 Y 亮度"}（${compDesc}）  8×8 块数: ${nBlocks}  AC 系数参与统计: ${blocks.length - nBlocks}（DC 位除外）`);
  if (nBlocks * 64 < 64 || nBlocks < 16) {
    L.push("⚠ 块数过少，统计不可靠，结论仅参考。");
  }
  L.push("");

 // ---- 直方特征 ----
  const hist = new Int32Array(256);
  let zero = 0, one = 0, acCount = 0;
  for (let i = 0; i < blocks.length; i++) {
    if (i % 64 === 0) continue;
    const c = blocks[i];
    acCount++;
    if (c === 0) { zero++; hist[0]++; continue; }
    if (c === 1 || c === -1) one++;
    hist[mapCoeff(c)]++;
  }
  const sm = shrinkMetrics(hist);
  L.push("--- 系数直方特征 ---");
  L.push(fmtRows([
    [`零系数占比`, `${zero} (${pct(zero / acCount)})`],
    [`±1 系数占比`, `${one} (${pct(one / acCount)})`],
    [`H(±1)/H(±2) = r12`, fmt(sm.r12)],
    [`H(±2)/H(±3) = r23`, fmt(sm.r23)],
    [`H(±3)/H(±4) = r34`, fmt(sm.r34)],
  ]));
  L.push("");

 // ---- chi-square（Westfeld/Pfitzmann 口径） ----
  L.push("--- Chi-square 攻击（Westfeld/Pfitzmann） ---");
  const overall = chiSquareFromHist(hist);
  L.push(`● 全图: χ²=${fmt(overall.chi2, 1)}  自由度=${overall.df}  有效对数=${overall.pairs}  p=${fmt(overall.p)}`);

  const FRACS = [];
  for (let i = 1; i <= 20; i++) FRACS.push(i / 20); // 5% 步进
  const curve = cumulativeChi2(blocks, FRACS);
  L.push(`● 累计卡方曲线（${interleavedScan ? "按 MCU 解码序" : "按系数数组顺序"}，从头累计）：`);
  L.push("  " + curve.map((c) => `${Math.round(c.frac * 100)}%:${fmt(c.p, 2)}`).join("  "));
  if (fr.progressive) L.push("  ⚠ 渐进式 JPEG：块序为解码序非光栅序，顺序特征仅供参考。");

  const chunks = chunkedChi2(blocks, 10);
  L.push(`● 非累计分块 p（10 段，看嵌入区域连续性）：`);
  L.push("  " + chunks.map((c, i) => `#${i + 1}:${fmt(c.p, 2)}`).join("  "));
  L.push("");

 // ---- 特征判定 ----
  const seq = seqSignature(curve, T);
  const shrinkBad = Number.isFinite(sm.r12) && Number.isFinite(sm.r23) && sm.r23 > 0 && sm.r12 > SHRINK_K * sm.r23;

  L.push("--- 特征指标 ---");
  L.push(`● 判定阈值（灵敏度=${sens}）: 整体 p ≥ ${T} → 判 χ² 异常`);
  L.push(`● 顺序嵌入特征（jsteg/jphide 系）: ${seq.seq ? `✓ 有——累计 p 高段约到全图 ${pct(seq.uptoFrac, 0)}，末段跌至 ${fmt(seq.lastP, 3)}` : "× 无"}`);
  L.push(`● 收缩参考指标（F5 系常见，但干净图也可自然偏高，仅供参考）: r12/r23 = ${fmt(Number.isFinite(sm.r23) && sm.r23 > 0 ? sm.r12 / sm.r23 : NaN, 2)}（经验线 ${SHRINK_K}）→ ${shrinkBad ? "偏高" : "正常"}`);
  L.push("");

 // ---- 结论 ----
  L.push("--- 结论 ---");
  const fired = overall.p >= T;
  if (seq.seq) {
    L.push(`✓ 检出：疑似 LSB 顺序嵌入（jsteg/jphide 系特征典型）——嵌入区域连续（约前 ${pct(seq.uptoFrac, 0)}），累计 p 高段后跌至 ${fmt(seq.lastP, 3)}。`);
  } else if (fired) {
    L.push(`✓ 检出：疑似 LSB 类嵌入（jsteg/jphide/F5 家族）——整体 χ² p=${fmt(overall.p)} ≥ ${T}，PoV 对趋平。`);
    if (seq.highP !== undefined) L.push(`  累计曲线峰值 p=${fmt(seq.highP, 3)}。`);
    L.push(`  未见顺序跌落 → 可能整图嵌满或经置乱（F5 置乱序）；请结合上方 r12/r23 收缩指标人工复核。`);
  } else {
    L.push(`✗ 未检出（整体 p=${fmt(overall.p)} < ${T}，PoV 对未趋平，无顺序嵌入特征）。`);
    L.push("  注意：低嵌入率（χ² 对稀疏修改天然不敏感）、F5 矩阵编码低密度嵌入为已知漏检区；");
    L.push("  原版 stegdetect 亦非百发百中，建议再以直方图观察 / 已知密钥提取验证。");
  }
  L.push("");
  L.push("说明:");
  L.push("  · 本 op 为近似实现，非原版 stegdetect（Provos C 工具）：仅 chi-square 攻击 + jsteg/F5 特征启发式，不追分数。");
  L.push("  · chi-square 口径：PoV 对 (2i,2i+1)（i≥1），n(i)=(h(2i)+h(2i+1))/2，χ²=Σ(h(2i)−n(i))²/n(i)，df=有效对数−1；直方图按幅度 |c| 统计（正负折叠）。");
  L.push("  · 结论均带「疑似」——最终以人工复核（直方图观察 / 已知工具验证）为准。纯本地计算、零外发。");
  return L.join("\n");
}

// ============================================================
// 注册
// ============================================================
register({
  id: "stegdetect",
  cat: "analysis",
  name: "stegdetect 隐写检测",
  desc: "JPEG 隐写检测近似实现（非原版 stegdetect）：chi-square 卡方攻击（Westfeld/Pfitzmann 口径）+ jsteg 顺序 LSB 特征 + F5 直方收缩特征，输出检出/未检出结论与卡方 p 值、累计曲线、分块分布、直方特征供人工复核。纯前端零外发",
  acceptsBytes: true,
  params: [
    {
      key: "comp", label: "分析分量", type: "select", default: "y",
      options: [
        { value: "y", label: "仅 Y 亮度分量（快，jsteg/F5 主战场）" },
        { value: "all", label: "全部分量（Y+Cb+Cr，更全但更慢）" },
      ],
    },
    {
      key: "sens", label: "阈值灵敏度", type: "select", default: "std",
      options: [
        { value: "loose", label: "宽松（p≥0.2 即判出，易误报）" },
        { value: "std", label: "标准（p≥0.5）" },
        { value: "strict", label: "严格（p≥0.8，更少误报）" },
      ],
    },
  ],
  run: stegdetectRun,
});

export { stegdetectRun, chi2SF, chiSquareFromHist, mapCoeff, cumulativeChi2, chunkedChi2, shrinkMetrics };
