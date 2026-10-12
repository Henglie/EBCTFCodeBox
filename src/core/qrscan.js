/*
 * qrscan.js — 二维码「图片扫描」：从一张**图片**直接解出二维码内容
 *
 * 纯前端、零外发、离线可用。原有 qrDecode / qrFormatBrute 只处理 0/1 矩阵（ASCII art 或 0-1 行），
 * qrParse（矩阵结构解析）已并入本入口（矩阵 → 结构解析）；从没把**像素**喂给二维码检测。
 * 本模块补上「图片 → 像素 → 模块矩阵 → 现用解码器」的完整链路。
 *
 * 链路：
 *   图片字节（dataURL / base64 / hex / 原始字节）
 *     → RGBA（PNG 走纯 JS decodePNG；其他格式走浏览器 createImageBitmap）
 *     → 灰度
 *     → 二值化（Otsu / 自适应 / 固定阈值三档轮试）× 极性（正/反色）
 *     → 定位符检测（尺度无关，双轴独立扫 + 聚类投票）
 *     → 三点仿射采样（+ 定位符模板自校准 + 对齐图案校正 + 单应/IDW）
 *     → 交给现用 qrDecodeMatrix 解码（finder 检测 / 格式信息 / 去交织 / RS 纠错 / 分段还原）
 *   前四条路径全部失败时，再走「无定位符」兜底（见下）
 *
 * 复用原则：解码本身**一律走现用 qrDecodeMatrix / qrErasureDecode**，本模块只做
 * 「读图这一段」，不重写任何 QR 解码算法。几何层由 qrscanSample / qrscanFind / qrscanRefine 提供。
 *
 * 两条能力补强：
 *   ① **诊断汇总**：失败时不再只抛「最后一条错误」，而是把**逐路径逐阶段**的尝试
 *      全部留痕（哪一档二值化、检出几个定位符、采样到哪个版本、卡在定位符/格式信息/
 *      RS 纠错/容量判据的哪一步、擦除点有多少），并给出「到达的最深阶段 + 主因 + 建议」。
 *      契约：`scanGrayDiag()` 返回结构化诊断；`scanGray()` 失败时把诊断挂在 `err.diag`；
 *      `qrScanImage({report:true})` 失败时也返回完整报告（不再抛错）。
 *   ② **无定位符 / 遮挡兜底**（`src/core/qrFindless.js`）：定位符是**功能图案**
 *      （ISO/IEC 18004 §6.3.2），其取值由规范确定、不承载数据 —— 抹掉它只丢几何参照。
 *      故定位符检测不出 3 个时，改由图像自身的尺度证据重建网格（整图=符号 / 稳健外接框 /
 *      静默区模型 / 游程节距），朝向按 D4 八变换枚举，ECL+掩码未知时穷举 32 组并以
 *      「重编码回同一码字流」把关；同时按「模块邻域是否属于两种墨色之一」标出**擦除位置**，
 *      交给带擦除的 RS（容量按 ISO/IEC 18004 §6.5：e + 2v ≤ nsym）。
 *
 * 为什么不改 qrDecode 本身：qrDecode 的契约是"矩阵入、文本出"，很多调用方（MCP、
 * 配方链、批量解码）依赖该契约；图片扫描是**新增能力**，独立成 op 不破坏既有契约。
 */
import { register } from "./registry.js";
import { qrDecodeMatrix, ALIGNMENT_PATTERN_CENTERS } from "./qrdecode.js";
import { decodeBruteWithErasures } from "./qrErasureDecode.js";
import { pickMode, encodedBitLength, getNumDataCodewords, qrParseOp } from "./qrcode.js";
import { decodePNG } from "./stegoPixels.js";
import { b64ToBytes } from "./bytesIo.js";
import { binarize, invertBits } from "./qrscanSample.js";
import {
  findFinderCentersDual, findFinderCentersScaled, orderThree,
  candidatesFromFinders, refineTrioByFinderScore, sampleAffine,
} from "./qrscanFind.js";
import { sampleAligned, buildRefinedCandidates } from "./qrscanRefine.js";
import { detectAndSample } from "./symboldetect.js";
import { decodeFindlessFromGray, decodeFindless, estimateInk, moduleInkConfidence } from "./qrFindless.js";
import { zxingReadRgba, qrZxingFormatsOf } from "./qrZxing.js";

// ============================================================
// 输入解析：dataURL / base64 / hex / 原始字节 → Uint8Array
// 走 bytesIo.b64ToBytes（项目内 base64↔字节的唯一来源，纯 JS、浏览器/Node 通用）——
// 不能用 Buffer：浏览器没有该全局，会让「粘贴 base64/dataURL」这条路直接抛错。
// ============================================================
function toBytes(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (Array.isArray(input)) return Uint8Array.from(input);
  if (typeof input !== "string") throw new Error("不支持的图片输入类型");

  let s = input.trim();
  const comma = s.indexOf(",");
  if (/^data:/i.test(s) && comma > 0) s = s.slice(comma + 1);   // 去掉 data:image/png;base64,
  s = s.replace(/\s+/g, "");

  const isHex = /^[0-9a-fA-F]+$/.test(s) && s.length % 2 === 0;
  // PNG 的 base64 一定以 iVBOR 开头；GIF 以 R0lGO；JPEG 以 /9j/
  if (/^iVBOR|^R0lGO|^\/9j\//.test(s)) return b64ToBytes(s);
  // hex 优先判 PNG 签名 89504e47
  if (isHex && /^89504e47|^47494638|^ffd8ff/i.test(s)) {
    const out = new Uint8Array(s.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(s.substr(i * 2, 2), 16);
    return out;
  }
  if (isHex) {
    const out = new Uint8Array(s.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(s.substr(i * 2, 2), 16);
    return out;
  }
  try { return b64ToBytes(s); }
  catch { throw new Error("无法解析图片输入：既不是合法 base64/dataURL，也不是十六进制字节串"); }
}

// ============================================================
// 图片 → RGBA
// ============================================================
async function bytesToRgba(bytes) {
  // PNG：走项目自带的纯 JS 解码器（Node 与浏览器都能跑）
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    const png = decodePNG(bytes);
    return { width: png.width, height: png.height, data: png.data };
  }
  // 其他格式：浏览器能力（JPEG / GIF / BMP / WebP 等交给浏览器原生解码）
  if (typeof createImageBitmap !== "function") {
    throw new Error("非 PNG 图片需要浏览器环境解码（当前环境无 createImageBitmap）；请改传 PNG，或转成 PNG 后再试");
  }
  const bmp = await createImageBitmap(new Blob([bytes]));
  if (typeof OffscreenCanvas !== "function") {
    throw new Error("当前环境缺少 OffscreenCanvas，无法取像素");
  }
  const cv = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = cv.getContext("2d");
  ctx.drawImage(bmp, 0, 0);
  const img = ctx.getImageData(0, 0, bmp.width, bmp.height);
  return { width: bmp.width, height: bmp.height, data: img.data };
}

// ============================================================
// RGBA → 灰度（Rec.601；透明按白底合成，避免透明区被判成暗模块）
// ============================================================
function rgbaToGray(data, w, h) {
  const gray = new Array(w * h);
  for (let i = 0, j = 0; j < w * h; i += 4, j++) {
    const a = data[i + 3] / 255;
    const r = data[i] * a + 255 * (1 - a);
    const g = data[i + 1] * a + 255 * (1 - a);
    const b = data[i + 2] * a + 255 * (1 - a);
    gray[j] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
  }
  return gray;
}

// ============================================================
// 诊断汇总：阶段定义 + 错误归类
// ============================================================
// 阶段按「链路深度」排序，深度越大表示链路走得越远。失败归因取「到达的最深阶段」，
// 这样就不会像旧行为那样只留最后一条错误、把真因（如 RS 超容限）掩盖掉。
const STAGES = [
  ["image", "图像解析"],
  ["binarize", "二值化"],
  ["finder", "定位符检测"],
  ["grid", "网格采样"],
  ["format", "格式信息"],
  ["version", "版本信息"],
  ["data", "数据取数"],
  ["rs", "RS 纠错"],
  ["erasure", "擦除容量"],
  ["segment", "数据段解析"],
  ["capacity", "容量判据"],
  ["reencode", "重编码判据"],
  ["ambiguous", "多解歧义"],
];
const STAGE_LABEL = Object.fromEntries(STAGES);
const STAGE_DEPTH = Object.fromEntries(STAGES.map(([k], i) => [k, i]));

/** 把任意错误归类到阶段（消息来自 qrdecode / rsErasure / qrErasureDecode / qrFindless） */
function classifyStage(e) {
  const m = String((e && e.message) || e || "");
  if (/finder 图案不足|定位符不足|finder count/.test(m)) return "finder";
  if (/无法识别格式信息/.test(m)) return "format";
  if (/版本信息不一致/.test(m)) return "version";
  if (/非正方形|尺寸 .*不符 QR|无合法正方形重采样|尺寸 .*非 QR 合法/.test(m)) return "grid";
  if (/超上限|弃用/.test(m)) return "erasure";
  if (/重编码/.test(m)) return "reencode";
  if (/歧义|文本不一致/.test(m)) return "ambiguous";
  if (/数据段/.test(m)) return "segment";
  if (/Chien|Λ|Forney|超出纠错能力|后验校正子|RS 纠错失败|gfInv|去交织/.test(m)) return "rs";
  if (/全部失败|全部网格候选/.test(m)) return "rs";
  return "data";
}

/** 新诊断容器（attempts 有界，防大图把内存顶爆） */
function newDiag(w, h) {
  return {
    image: { w, h, ink: null, bins: [] },
    finder: [],
    candidates: [],
    decodes: [],
    erasureTries: [],
    paths: [],
    findless: null,
    attempted: 0,
    ms: 0,
  };
}
const MAXREC = 240;
const clip = (s, n) => { s = String(s == null ? "" : s); return s.length > n ? s.slice(0, n) + "…" : s; };
function rec(diag, key, o) {
  const a = diag[key];
  if (a.length < MAXREC) a.push(o);
  else a[MAXREC - 1] = o; // 溢出时覆盖最后一条，避免无界增长
}

/** 汇总：到达的最深阶段 + 主因 + 建议 */
export function concludeDiag(diag) {
  const fails = diag.decodes.filter((d) => !d.ok);
  const byStage = new Map();
  const addStage = (s, reason) => {
    if (!byStage.has(s)) byStage.set(s, []);
    byStage.get(s).push({ stage: s, reason: reason || "" });
  };
  for (const f of fails) addStage(f.stage || "data", f.reason);
  // 无定位符兜底也走了链路，必须计入（否则会一律显示「定位符不足」，掩盖真因）
  if (diag.findless && !diag.findless.ok && diag.findless.stage) {
    addStage(diag.findless.stage, diag.findless.reason || "");
  }
  // 一次矩阵解码都没发起时（定位符不足 ⇒ 没有采样候选），按定位符检出数归因
  if (diag.decodes.length === 0) {
    const maxF = diag.finder.reduce((a, f) => Math.max(a, f.dual || 0, f.scaled || 0), 0);
    addStage(maxF < 3 ? "finder" : "grid", maxF < 3
      ? `定位符（1:1:3:1:1）最多只检出 ${maxF} 个，无法构成三点定标`
      : "定位符够但采不出合法网格");
  }
  let deepest = null;
  for (const [s] of byStage) {
    if (deepest == null || STAGE_DEPTH[s] > STAGE_DEPTH[deepest]) deepest = s;
  }
  const near = deepest == null ? null : byStage.get(deepest);
  const reason = near && near.length ? (near[0].reason || "") : "";
  const hints = {
    image: "图片无法解码为像素（非 PNG 且当前环境无浏览器 canvas），或整图灰度过于单一（无暗/亮对比）——请改用浏览器环境或检查素材是否为纯色/空白图。",
    binarize: "整图灰度过于单一（无暗/亮对比），二值化得不到有效位图——请检查素材是否为纯色/空白图。",
    finder: "定位符（ISO/IEC 18004 §6.3.2 的 1:1:3:1:1）不足 3 个；已尝试无定位符网格重建（整图/外接框/静默区/游程节距 四类尺度模型）仍无解——多为定位符被大面积涂改并伴随数据区超容限。",
    grid: "采样不出合法 QR 尺寸（21+4k）的网格——多为符号被裁切、非等比拉伸、多码平铺，或符号边界与图像边界不成整数节距关系。",
    format: "格式信息 15 位 BCH(15,5) 两份副本都被破坏且 32 组穷举无一成立——格式区与数据区同时损坏。",
    version: "版本信息（v7+ 的 18 位 BCH）与尺寸推出的版本不一致——版本区被涂改。",
    data: "取数后无法解析出有效数据段。",
    rs: "RS 纠错失败：码字错误/擦除超出该块纠错容量（ISO/IEC 18004 §6.5：e + 2v ≤ nsym，nsym 见附录 B 分块表）——信息已越过纠错上界，需更多可见模块或更精确的擦除位置。",
    erasure: "标出的擦除位置数已超过该块校验码字数 nsym（或达到 nsym 而无残余校验）——擦除信息本身不足以定位错误，属容量上界。",
    segment: "数据段解析失败（模式指示符/字符计数越界）。",
    capacity: "解出的文本装不进该 (版本, 纠错级)——判为假成功并拒绝。",
    reencode: "解出的文本无法重编码回同一码字流——判为假成功并拒绝。",
    ambiguous: "多组 (ECL, 掩码) 或多种朝向都能自洽解码且文本互不相同——按「不挑一个」策略报歧义。",
  };
  return {
    reached: deepest || "image",
    reachedLabel: STAGE_LABEL[deepest || "image"],
    reason,
    hint: hints[deepest || "image"] || "未能从图片中解出二维码。",
    byStage: Object.fromEntries([...byStage].map(([k, v]) => [k, v.length])),
    decodesTried: diag.decodes.length,
    erasureTried: diag.erasureTries.length,
  };
}

/** 渲染诊断报告（成/败都可用） */
export function renderDiagReport(diag, result) {
  const L = [];
  L.push(result ? "二维码扫描解析 ✓" : "二维码扫描解析 ✗（未解出）");
  L.push("图片尺寸: " + diag.image.w + " × " + diag.image.h + " px");
  // ZXing 路径命中的报告：几何/二值化等自研链路的留痕不适用，只报引擎与全部符号。
  if (diag.zxing) {
    const hits = diag.zxing.hits || [];
    L.push("读码引擎: ZXing-C++（WASM，随包内置，本地计算）" +
      (hits.length > 1 ? "；命中 " + hits.length + " 个符号" : ""));
    for (const h of hits) {
      L.push("　· " + (h.format || "-") + (h.ecLevel ? "/" + h.ecLevel : "") +
        (h.isInverted ? " 反色" : "") + (h.isMirrored ? " 镜像" : "") +
        " → " + JSON.stringify(String(h.text).slice(0, 70)));
    }
  } else {
  const ink = diag.image.ink;
  if (ink) {
    L.push("墨色估计: 暗=" + ink.dark + " 亮=" + ink.light + "（容差 " + ink.tol +
      "，灰度级数 " + ink.levels + "）；非墨像素占比 " + (ink.otherShare * 100).toFixed(1) +
      "%（>0 且成片出现即提示遮挡/异色）");
  }
  L.push("二值化档位: " + diag.image.bins.map((b) => b.method + (b.ok ? "" : "(不可用)")).join(" / "));
  const fc = diag.finder.map((f) => `${f.tag}: 双轴${f.dual}/单轴${f.scaled}`);
  L.push("定位符检出: " + (fc.length ? fc.join("；") : "（无）"));
  const byVia = {};
  for (const c of diag.candidates) byVia[c.via] = (byVia[c.via] || 0) + 1;
  L.push("采样候选: " + diag.candidates.length + " 个" +
    (diag.candidates.length ? "（" + Object.entries(byVia).map(([k, v]) => k + "×" + v).join("，") + "）" : ""));
  L.push("矩阵解码尝试: " + diag.decodes.length + " 次；擦除解码尝试: " + diag.erasureTries.length + " 次");
  if (diag.decodes.length) {
    const okList = diag.decodes.filter((d) => d.ok);
    if (okList.length) L.push("　其中成功: " + okList.map((d) => d.via).join("；"));
    const st = {};
    for (const d of diag.decodes) if (!d.ok) st[d.stage] = (st[d.stage] || 0) + 1;
    L.push("　失败阶段分布: " + Object.entries(st).map(([k, v]) => (STAGE_LABEL[k] || k) + "×" + v).join("，"));
  }
  if (diag.erasureTries.length) {
    const e = diag.erasureTries[diag.erasureTries.length - 1];
    L.push("　擦除诊断（末次）: 不可信模块 " + (e.inkErasedModules || 0) + "（墨色信号）+ " +
      (e.disagreeModules || 0) + "（二值化分歧）；擦除码字 " + (e.erasureCount == null ? "-" : e.erasureCount) +
      "，RS 纠正 " + (e.errorCount == null ? "-" : e.errorCount) + "；" + (e.reason || ""));
  }
  if (diag.findless) {
    const f = diag.findless;
    L.push("无定位符兜底: " + (f.ok ? "命中" : "未命中") +
      (f.notes && f.notes.length ? "（" + f.notes.join("；") + "）" : ""));
    if (f.grid) L.push("　命中网格: 模型 " + f.grid.model + "，n=" + f.grid.n + "，节距 " + f.grid.pitch.toFixed(2) + "px，原点 (" + f.grid.ox.toFixed(1) + "," + f.grid.oy.toFixed(1) + ")");
    const att = (f.attempts || []).slice(0, 6);
    for (const a of att) {
      L.push("　· " + a.model + " n=" + a.n + " 节距 " + (a.pitch || 0).toFixed(2) +
        " 不可信模块 " + ((a.erasedRatio || 0) * 100).toFixed(0) + "%" +
        " 时序 " + (a.timing == null || a.timing < 0 ? "不可测" : a.timing.toFixed(2)) +
        " 格式距 " + (a.fmtDist == null ? "-" : a.fmtDist) +
        " → " + (a.ok ? "命中" : (a.reason || "失败")));
    }
    if ((f.attempts || []).length > 6) L.push("　…（共 " + f.attempts.length + " 个网格候选尝试）");
    if (f.reason) L.push("　结论: " + f.reason);
  }
  }
  L.push("耗时: " + diag.ms + " ms");
  L.push("");
  if (result) {
    L.push("命中路径: " + result.via);
    L.push("版本: v" + result.version + "（" + result.size + "×" + result.size + "）");
    L.push("纠错级: " + (typeof result.ecl === "number" ? ["L", "M", "Q", "H"][result.ecl] : result.ecl) +
      "   掩码: " + result.mask);
    L.push("RS 纠正: " + (result.errorCount == null ? "-" : result.errorCount) + " 个错误" +
      (result.erasureCount ? ("，擦除 " + result.erasureCount + " 个") : ""));
    L.push("");
    L.push("原文:");
    L.push(result.text);
  } else {
    const c = diag.conclusion || concludeDiag(diag);
    L.push("卡在哪一步: " + c.reachedLabel + "（" + c.reached + "）");
    if (c.reason) L.push("主因: " + c.reason);
    L.push("各阶段失败计数: " + (Object.keys(c.byStage).length
      ? Object.entries(c.byStage).map(([k, v]) => (STAGE_LABEL[k] || k) + "×" + v).join("，") : "（无）"));
    L.push("建议: " + c.hint);
  }
  return L.join("\n");
}

// ============================================================
// 扫描主流程（带诊断留痕）
// ============================================================
const METHODS = [
  ["otsu", {}],
  ["adaptive", {}],
  ["adaptive", { window: 41, C: 12 }],
  ["fixed", { threshold: 128 }],
];

/**
 * 容量护栏（精确版）：解出的文本必须真能装进该 (版本, 纠错级)。
 *
 * 为什么用编码容量公式而不是"让 qrGenerate 再编一次"：
 * `qrGenerate(text, {version})` 在**显式指定版本**时不校验容量，超长文本会被截断成
 * 前 dataCap 个码字而照样返回 —— 于是「远超容量的超长串 + 大量填充」能蒙混过
 * 「重编码成功」这类判据。这里直接按 ISO/IEC 18004 §6.4 的容量口径算：
 *   编码位数 = 4（模式）+ 字符计数位 + 数据位；必须 ≤ 数据码字数 × 8。
 * 装不下就一定不是原文（RS 过纠正到另一个合法码字的典型形态就是这种超长串）。
 */
function fitsCapacity(text, version, eclIdx) {
  if (!text) return false;
  try {
    const mode = pickMode(text);
    const capBits = getNumDataCodewords(version, eclIdx) * 8;
    return encodedBitLength(text, mode, version) + 4 <= capBits;
  } catch {
    return false;
  }
}

/**
 * 在灰度图上尝试解出二维码，并**全程留痕**。
 *
 * 分级策略：
 *   ① 常规：采样出的矩阵直接交给现用 qrDecodeMatrix（快，覆盖绝大多数情况）；
 *   ② 擦除兜底：① 失败时，把「不可信模块」标为擦除位置交给带擦除的 RS 解码
 *      （ECL/掩码未知时穷举 32 组组合）。不可信信号有**两路、互为独立证据**：
 *      a) 两种独立二值化的分歧（原信号，纯客观）；
 *      b) 模块邻域内既不属于暗墨也不属于亮墨的像素占比过高（ISO/IEC 18004 §6.1：
 *         模块只有暗/亮两态）—— 这是识别**遮挡/异色覆盖**的关键信号，
 *         因为整片均匀中间灰在 a) 里各二值化档位会给出**一致**结果，a) 完全失效。
 *      取两者并集（任一为不可信即擦除）。
 *   ③ 层⑥ 图像→符号检测层（symboldetect.js）候选；
 *   ④ 无定位符兜底（qrFindless.js）：定位符是功能图案，缺失只丢几何参照，
 *      故可由图像尺度证据重建网格 + D4 朝向枚举 + 32 组穷举 + 重编码判据。
 *      仅在 ①~③ 全部失败时运行 ⇒ 现行可解的图行为完全不变。
 *
 * @returns {{ok:boolean, result?:object, diag:object}}
 */
function scanGrayDiag(gray, w, h, opt = {}) {
  const t0 = Date.now();
  const deadline = t0 + (opt.budgetMs == null ? 8000 : opt.budgetMs);
  const useErasure = opt.erasure !== false;
  const diag = newDiag(w, h);
  let lastErr = null;

  diag.image.ink = estimateInk(gray);
  // 单墨（无对比）图不可能含二维码：ISO/IEC 18004 §6.1 的模块只有「暗」「亮」两态，
  // 故必须先存在两种墨色。这里把「只有一种灰度」明确归到二值化阶段，
  // 后续不再浪费预算去枚举网格候选（纯白/纯黑/纯色素材会因此给出正确归因）。
  const ink0 = diag.image.ink;
  const twoInk = (ink0.light - ink0.dark) > ink0.tol;
  if (!twoInk) {
    rec(diag, "decodes", { via: "-", n: 0, ok: false, stage: "binarize",
      reason: `整图只有一种灰度（${ink0.dark}，灰度级数 ${ink0.levels}），无暗/亮对比，不可能含二维码` });
  }

  // 同一张图的多套二值化结果（用于互证 / 分歧检测 / 兜底）
  const bins = [];
  for (const [m, mopt] of METHODS) {
    try {
      const b = binarize(gray, w, h, m, mopt);
      bins.push({ m, mopt, bin: b });
      diag.image.bins.push({ method: m + (mopt.window ? `(w${mopt.window})` : mopt.threshold != null ? `(t${mopt.threshold})` : ""), ok: true, threshold: b.threshold });
    } catch (e) {
      diag.image.bins.push({ method: m, ok: false, note: String((e && e.message) || e) });
    }
  }
  if (!bins.length) {
    diag.ms = Date.now() - t0;
    diag.conclusion = concludeDiag(diag);
    return { ok: false, diag };
  }

  const noteDecode = (via, n, r, err) => {
    diag.attempted++;
    if (r) {
      // 命中：后续可能因容量判据被拒，故 ok 由调用方最终裁定；此处先记成功候选
      rec(diag, "decodes", { via, n, ok: true, stage: "done", ecl: r.ecl, mask: r.mask, errorCount: r.errorCount, text: String(r.text || "").slice(0, 80) });
      return;
    }
    rec(diag, "decodes", { via, n, ok: false, stage: classifyStage(err), reason: clip(String((err && err.message) || err), 200) });
  };

  const tryMatrix = (mat, n, via) => {
    if (!mat) return null;
    const ver = (n - 17) / 4;
    try {
      const r = qrDecodeMatrix(mat, n, n);
      if (r && r.text) {
        // 容量闸（精确，ISO/IEC 18004 §6.4）：**常规路径也要过**。
        // 为什么：版本估计错（如把 v2 的图按 n=29 采样）时，RS 仍能在错的 (版本, 纠错级, 掩码)
        // 上找到一个「合法码字」，产出的串往往远超该版本容量（典型形态：可读前缀 + 大量填充字符）。
        // 实测在真实 JPEG 上踩到过：同一枚二维码在 n=29 上解出「http://www.4f??ao1o2VLVK:…0000」
        // （v3 无论哪个纠错级都装不下这么长的串），而在正确的 n=25 上解出干净内容。
        // 装不下就一定不是原文 ⇒ 拒绝该候选，让后续（正确的）候选有机会命中。
        if (fitsCapacity(r.text, ver, r.eclIndex)) {
          noteDecode(via, n, r, null);
          return { ...r, via: `${via}` };
        }
        noteDecode(via, n, null, new Error(
          `容量判据不通过：解出 ${r.text.length} 字符装不进 v${ver}-${r.ecl}（判为假成功）`));
      } else {
        noteDecode(via, n, null, new Error("解码返回空文本"));
      }
    } catch (e) {
      lastErr = e;
      // 几何已由定位符定标（TL/P1/P2 已确定网格），但采出的矩阵里 `countFinders`
      // 未达 3 个 —— 这是**读数**不达标，不是**几何**不成立：定位符是规范固定值的
      // 功能图案（ISO/IEC 18004 §6.3.2），解码真正需要的只是「合法尺寸 + 正确朝向 +
      // 已知/可穷举的 ECL 与掩码」。故此处改走无定位符解码入口（D4 八变换 × 32 组
      // 穷举 + 重编码判据），并用规范值复位功能图案区（抗锯齿/半模块偏移常把定位符读花）。
      // 该分支只在既有路径**已经失败**时触发，故不可能改变现行可解图的行为。
      if (classifyStage(e) === "finder") {
        try {
          const r2 = decodeFindless(mat, n, { budget: 400, deadline, conf: null });
          if (r2.ok) {
            noteDecode(via + "+nofinder", n, r2, null);
            return { text: r2.text, version: r2.version, size: n, ecl: r2.ecl, mask: r2.mask,
                     errorCount: r2.errorCount, erasureCount: r2.erasureCount,
                     via: `${via}+nofinder/${r2.iso}` };
          }
          noteDecode(via + "+nofinder", n, null, new Error(String(r2.reason || "无定位符入口未命中")));
        } catch (e2) { noteDecode(via + "+nofinder", n, null, e2); }
      }
      noteDecode(via, n, null, e);
    }
    return null;
  };

  /**
   * 擦除兜底：把「不可信模块」标为擦除位置，走带擦除的 RS。
   * 不可信 = 二值化分歧 ∪ 非墨像素占比过高（详见函数头注释的 a) / b) 两路信号）。
   * ⚠ `pol` 必须传进来：反色图走的是 `invertBits` 后的位图，若第二套二值化不一起取反，
   *   两张位图会**处处不同** ⇒ 全部模块被判为分歧、擦除数爆掉，反色图必然全军覆没。
   */
  const tryErasure = (mat, n, TL, TR, BL, via, selfIdx, pol) => {
    if (!useErasure) return null;
    const ver = (n - 17) / 4;
    if (!Number.isInteger(ver) || ver < 1 || ver > 40) return null;
    const span = n - 7;
    const pitch = Math.max(
      Math.hypot(TR.x - TL.x, TR.y - TL.y) / span,
      Math.hypot(BL.x - TL.x, BL.y - TL.y) / span);
    const nb = pitch >= 6 ? 1 : 0;
    // b) 墨色信号：模块邻域内「既不属于暗墨也不属于亮墨」的像素占比过高 ⇒ 该模块不可信
    let inkConf = null;
    try {
      inkConf = moduleInkConfidence(gray, w, h, TL, TR, BL, n, { nb, ink: diag.image.ink }).conf;
    } catch { inkConf = null; }

    for (let k = 0; k < bins.length; k++) {
      if (k === selfIdx) continue;   // 必须换一套二值化才有「分歧」可言（同档 + 同极性 = 同一张图）
      let mat2 = null;
      try {
        const bits2 = pol ? invertBits(bins[k].bin.bits) : bins[k].bin.bits;
        mat2 = sampleAffine(bits2, w, h, TL, TR, BL, n, 1, 1);
      } catch { continue; }
      if (!mat2) continue;
      const conf = [];
      let inkErased = 0, divErased = 0;
      for (let r = 0; r < n; r++) {
        const row = new Array(n);
        for (let c = 0; c < n; c++) {
          const diverge = (mat[r][c] === mat2[r][c]) ? 1 : 0.05;
          const ink = inkConf ? inkConf[r][c] : 1;
          const v = Math.min(diverge, ink);
          if (diverge < 1) divErased++;
          if (ink < 1) inkErased++;
          row[c] = v;
        }
        conf.push(row);
      }
      // 两道判据，先严后宽：
      //  严 —— 「重编码回同一码字流」（编码确定性，可彻底排除过纠正假成功；容量闸已在
      //        qrErasureDecode.reencodeMatches 内按 ISO/IEC 18004 §6.4 前置）；
      //  宽 —— 退化为「纯擦除纠正」替代判据（eras ≥ err）+ 精确容量闸。
      // 先严后宽：能过严判据的解证据最强；严判据不适用的场合（如原编码器的分段方式与
      // 本工具箱不同）再用宽判据兜住，二者都过不了就宁可不报。
      let r2 = null, err = null;
      try { r2 = decodeBruteWithErasures(mat, conf, n, ver, { requireReencode: true }); } catch (e) { err = e; }
      let strictMiss = null;
      if (r2 && r2.ok && r2.text && fitsCapacity(r2.text, ver, r2.ecl)) {
        rec(diag, "erasureTries", { via: `${via}+eras(${bins[k].m})`, n, inkErasedModules: inkErased,
          disagreeModules: divErased, erasureCount: r2.erasureCount, errorCount: r2.errorCount, ok: true, reason: "重编码判据通过" });
        rec(diag, "decodes", { via: `${via}+eras(${bins[k].m})`, n, ok: true, stage: "done", ecl: r2.ecl, mask: r2.mask, errorCount: r2.errorCount, erasureCount: r2.erasureCount, text: String(r2.text).slice(0, 80) });
        return { text: r2.text, version: ver, size: n, ecl: r2.ecl, mask: r2.mask,
                 errorCount: r2.errorCount, erasureCount: r2.erasureCount, via: `${via}+eras(${bins[k].m})` };
      }
      strictMiss = r2 ? (r2.ok ? `容量判据不通过（eras=${r2.erasureCount} err=${r2.errorCount}）` : r2.reason) : String((err && err.message) || err);

      let r3 = null;
      try { r3 = decodeBruteWithErasures(mat, conf, n, ver, { requireReencode: false }); } catch (e) { err = e; }
      const loose = r3 && r3.ok && r3.text && (r3.erasureCount || 0) >= (r3.errorCount || 0) && fitsCapacity(r3.text, ver, r3.ecl);
      rec(diag, "erasureTries", {
        via: `${via}+eras(${bins[k].m})/loose`, n,
        inkErasedModules: inkErased, disagreeModules: divErased,
        erasureCount: r3 ? r3.erasureCount : null,
        errorCount: r3 ? r3.errorCount : null,
        ok: loose, reason: loose ? "纯擦除判据通过" : (r3 ? (r3.ok ? `容量/纯擦除判据不通过（eras=${r3.erasureCount} err=${r3.errorCount}）` : r3.reason) : String((err && err.message) || err)),
      });
      if (loose) {
        rec(diag, "decodes", { via: `${via}+eras(${bins[k].m})/loose`, n, ok: true, stage: "done", ecl: r3.ecl, mask: r3.mask, errorCount: r3.errorCount, erasureCount: r3.erasureCount, text: String(r3.text).slice(0, 80) });
        return { text: r3.text, version: ver, size: n, ecl: r3.ecl, mask: r3.mask,
                 errorCount: r3.errorCount, erasureCount: r3.erasureCount, via: `${via}+eras(${bins[k].m})` };
      }
      rec(diag, "decodes", { via: `${via}+eras(${bins[k].m})`, n, ok: false, stage: "capacity",
        reason: `严判据：${clip(String(strictMiss), 120)}；宽判据：${clip(String((err && err.message) || (r3 && r3.reason) || "未通过"), 120)}` });
    }
    return null;
  };

  let hit = null;
  for (let bi = 0; bi < bins.length && !hit; bi++) {
    if (Date.now() > deadline) break;
    const bitsRaw = bins[bi].bin.bits;

    for (const pol of [0, 1]) {
      if (hit) break;
      if (Date.now() > deadline) break;
      const bits = pol ? invertBits(bitsRaw) : bitsRaw;
      const tag = `${bins[bi].m}${pol ? "/inv" : ""}`;

      // 路径一：双轴独立扫 + 聚类投票
      try {
        const fDual = findFinderCentersDual(bits, w, h, 1);
        rec(diag, "finder", { tag: tag + "/dual", dual: fDual.length, scaled: -1 });
        if (fDual.length >= 3) {
          const trio = orderThree(fDual);
          if (trio) {
            for (const c of candidatesFromFinders(bits, w, h, trio, { maxCand: 8 })) {
              if (Date.now() > deadline) break;
              rec(diag, "candidates", { via: `${tag}/dual/${c.swapped}`, n: c.n, pitch: c.pitch });
              hit = tryMatrix(c.matrix, c.n, `${tag}/dual/${c.swapped}/n${c.n}`);
              if (hit) break;

              const rf = refineTrioByFinderScore(bits, w, h, { TL: c.TL, P1: c.TR, P2: c.BL }, c.n, {});
              const nb = c.pitch >= 6 ? 1 : 0;
              const matR = sampleAffine(bits, w, h, rf.trio.TL, rf.trio.P1, rf.trio.P2, c.n, nb, nb);
              hit = tryMatrix(matR, c.n, `${tag}/dual+cal/${c.swapped}/n${c.n}`);
              if (hit) break;

              const ver = (c.n - 17) / 4;
              const alTable = Number.isInteger(ver) && ver >= 1 && ver <= 40
                ? ALIGNMENT_PATTERN_CENTERS[ver] : null;

              for (const rr of buildRefinedCandidates(bits, w, h, rf.trio.TL, rf.trio.P1, rf.trio.P2, c.n, alTable, {})) {
                hit = tryMatrix(rr.matrix, c.n, `${tag}/dual/${rr.kind}/${c.swapped}/n${c.n}`);
                if (hit) break;
              }
              if (hit) break;
              const al = alTable
                ? sampleAligned(bits, w, h, rf.trio.TL, rf.trio.P1, rf.trio.P2, c.n, alTable, {})
                : null;
              if (al) {
                hit = tryMatrix(al.matrix, c.n, `${tag}/dual+cal/${c.swapped}/n${c.n}/ALIGN`);
                if (hit) break;
              }

              // 擦除兜底：几何已对齐（finder 评分高）但码字超容限时，这是唯一出路
              hit = tryErasure(c.matrix, c.n, c.TL, c.TR, c.BL, `${tag}/dual/${c.swapped}/n${c.n}`, bi, pol);
              if (hit) break;
            }
          }
        }
      } catch (e) { lastErr = e; noteDecode(`${tag}/dual`, 0, null, e); }

      // 路径二：单轴检测（与路径一互补——实测两者给出的定位符组合互不包含）
      try {
        const fOld = findFinderCentersScaled(bits, w, h, 1);
        rec(diag, "finder", { tag: tag + "/scaled", dual: -1, scaled: fOld.length });
        if (fOld.length >= 3) {
          const trioS = orderThree(fOld);
          if (trioS) {
            for (const c of candidatesFromFinders(bits, w, h, trioS, { maxCand: 6 })) {
              if (Date.now() > deadline) break;
              rec(diag, "candidates", { via: `${tag}/scaled/${c.swapped}`, n: c.n, pitch: c.pitch });
              hit = tryMatrix(c.matrix, c.n, `${tag}/scaled/${c.swapped}/n${c.n}`);
              if (hit) break;
              hit = tryErasure(c.matrix, c.n, c.TL, c.TR, c.BL, `${tag}/scaled/${c.swapped}/n${c.n}`, bi, pol);
              if (hit) break;
            }
          }
        }
      } catch (e) { lastErr = e; noteDecode(`${tag}/scaled`, 0, null, e); }
    }
  }

  // 路径三（增量兜底）：层⑥ 图像→符号检测层（src/core/symboldetect.js）。
  // 仅在既有两条路径**全部失败**时运行 —— 因此当前可解的图行为完全不变。
  if (!hit && Date.now() <= deadline) {
    try {
      const sd = detectAndSample(gray, w, h, { tryInverted: true });
      const q = sd && sd.qr;
      const cands = q && q.candidates ? q.candidates : [];
      rec(diag, "paths", { name: "symboldetect", candidates: cands.length, inverted: !!(q && q.inverted) });
      for (const c of cands) {
        if (Date.now() > deadline) break;
        const tag = `symboldetect${q.inverted ? "/inv" : ""}/n${c.n}`;
        const vers = (c.n - 17) / 4;
        rec(diag, "candidates", { via: tag, n: c.n, pitch: null, finderScore: c.score, timingScore: c.timingScore });
        const m1 = tryMatrix(c.grid, c.n, tag);
        if (m1 && fitsCapacity(m1.text, vers, m1.ecl)) { hit = m1; break; }
        const tr = c.grid.map((row, r) => row.map((_, cc) => c.grid[cc][r]));
        const m2 = tryMatrix(tr, c.n, tag + "/T");
        if (m2 && fitsCapacity(m2.text, vers, m2.ecl)) { hit = m2; break; }
      }
    } catch (e) { lastErr = e; noteDecode("symboldetect", 0, null, e); }
  }

  // 路径四（增量兜底）：无定位符网格重建（src/core/qrFindless.js）。
  // 定位符是功能图案（ISO/IEC 18004 §6.3.2），缺失只丢几何参照、不丢数据；
  // 故改由图像尺度证据建网格 + D4 朝向枚举 + 32 组 (ECL,掩码) 穷举 + 重编码判据。
  // 同样**仅在 ①~③ 全部失败时**运行；单墨图直接跳过（无两种墨色 ⇒ 不可能含 QR）。
  if (!hit && twoInk && Date.now() <= deadline) {
    const remain = deadline - Date.now();
    try {
      const fl = decodeFindlessFromGray(gray, w, h, {
        budgetMs: Math.min(remain, opt.findlessBudgetMs == null ? 4000 : opt.findlessBudgetMs),
        maxCand: opt.findlessMaxCand == null ? 16 : opt.findlessMaxCand,
      });
      diag.findless = {
        ok: !!fl.ok, reason: fl.reason || "", stage: fl.stage || "grid",
        notes: fl.notes || [], ink: fl.ink || null,
        candidateCount: fl.candidateCount || 0,
        grid: fl.grid ? { model: fl.grid.model, n: fl.grid.n, pitch: fl.grid.pitch, ox: fl.grid.ox, oy: fl.grid.oy } : null,
        attempts: (fl.attempts || []).map((a) => ({
          model: a.model, n: a.n, pitch: a.pitch, erasedRatio: a.erasedRatio,
          timing: a.timing, fmtDist: a.fmtDist, ok: a.ok, stage: a.stage,
          reason: a.ok ? "" : clip(String(a.reason || ""), 160),
        })),
      };
      if (fl.ok) {
        hit = { text: fl.text, version: fl.version, size: fl.size, ecl: fl.ecl, mask: fl.mask,
                errorCount: fl.errorCount, erasureCount: fl.erasureCount,
                via: `findless/${fl.grid.model}/n${fl.size}/${fl.iso}` + (fl.erasureCount ? "+eras" : "") };
        rec(diag, "decodes", { via: hit.via, n: fl.size, ok: true, stage: "done", ecl: fl.ecl, mask: fl.mask, errorCount: fl.errorCount, erasureCount: fl.erasureCount, text: String(fl.text).slice(0, 80) });
      }
    } catch (e) {
      diag.findless = { ok: false, reason: String((e && e.message) || e), notes: [], attempts: [] };
      lastErr = e;
    }
  }

  diag.ms = Date.now() - t0;
  diag.conclusion = concludeDiag(diag);
  if (hit) return { ok: true, result: hit, diag };

  const err = new Error(
    "未能从图片中解出二维码（卡在：" + diag.conclusion.reachedLabel +
    (diag.conclusion.reason ? "｜主因：" + diag.conclusion.reason : "") + "）"
  );
  err.diag = diag;
  return { ok: false, diag, error: err };
}

/** 兼容入口：成功返回结果，失败抛错（诊断挂在 err.diag） */
function scanGray(gray, w, h, opt = {}) {
  const r = scanGrayDiag(gray, w, h, opt);
  if (r.ok) return r.result;
  throw r.error;
}

// ============================================================
// ZXing 读码路径（工业级检测器）
// ============================================================
// 为什么单开一条：自研链路强在**规范内可证的退化形态**（定位符被抹 / 遮挡擦除 /
// 非整节距），弱在**真实拍摄图**的通用鲁棒性——任意位置、透视畸变、旋转、反色、
// 多符号平铺、网点半色调、低对比底图。后者恰是 ZXing-C++ 检测器的长项，两者互补
// 而非替换：引擎不可用（资产未随包/加载失败）时本函数返回 null，静默回退自研链路，
// 既有行为一行不变。
async function tryZxing(rgba, w, h, opt = {}) {
  if (!rgba || !w || !h) return null;
  try {
    const formats = qrZxingFormatsOf(opt.formats);
    let hits = await zxingReadRgba(rgba, w, h, { formats });
    if (!hits || !hits.length) {
      // 二段重试：tryDownscale 对「生成型锐利 1D 条码」会把模块缩糊导致读不出
      //（拍照大图找小码的优化，对满幅条码反有害）；空结果时关掉再扫一次，仅失败路径付代价。
      hits = await zxingReadRgba(rgba, w, h, { formats, tryDownscale: false });
    }
    if (!hits || !hits.length) return null;
    // 放开读码范围后**二维码仍排最前**：本 op 的主语义是二维码，其余符号（条码/DataMatrix/
    // PDF417/Aztec）在诊断报告里逐个列出。若不做这步，「全部格式」会把 Aztec 之类顶到第一条，
    // 用户反而看不到图里的二维码（实测 0.png：不排序时首条变成 Aztec 而不是 QR）。
    // 组内保持引擎原顺序（稳定划分），不改变同一格式内的先后。
    return hits.filter((h) => h.format === "QRCode").concat(hits.filter((h) => h.format !== "QRCode"));
  } catch {
    return null;
  }
}

/** ZXing 命中 → 报告口径 result（字段与自研链路同形；引擎不提供的项如实标 "-"）。 */
function zxingHitToResult(h, n) {
  const v = parseInt(h.version, 10);
  const hasV = Number.isFinite(v) && v >= 1 && v <= 40;
  const tags = ["zxing"];
  if (h.isInverted) tags.push("inv");
  if (h.isMirrored) tags.push("mir");
  return {
    text: h.text,
    via: tags.join("/") + (n > 1 ? "+multi" + n : ""),
    version: hasV ? v : "-",
    size: hasV ? 17 + 4 * v : "?",
    ecl: h.ecLevel || "-",
    mask: "-",
    errorCount: null,
    erasureCount: 0,
  };
}

// ============================================================
// op 实现
// ============================================================
/**
 * RGBA 像素 → 扫描结果。**两条链的合流点**，所有图片入口都走这里，保证
 * 「工具页扫码」与「拖入图片智能识别」结论一致：
 *   ① ZXing 读码优先（工业级检测器，毫秒级，覆盖真实拍摄图/透视/多符号/半色调）；
 *   ② 未命中再走自研链路（定位符缺失 / 遮挡擦除 / 非整节距）。
 * 返回与 scanGrayDiag 同形：{ok, result?, error?, diag}；ZXing 命中时 result.via 以 "zxing" 起头。
 */
export async function scanRgba(rgba, w, h, opt = {}) {
  const t0 = Date.now();
  const zxHits = await tryZxing(rgba, w, h, opt);
  if (zxHits) {
    const diag = newDiag(w, h);
    diag.zxing = { hits: zxHits };
    diag.ms = Date.now() - t0;
    return { ok: true, result: zxingHitToResult(zxHits[0], zxHits.length), diag, zxHits };
  }
  return scanGrayDiag(rgbaToGray(rgba, w, h), w, h, opt);
}

async function qrScanImage(input, p = {}) {
  const bytes = toBytes(input);
  if (!bytes.length) throw new Error("输入为空");

  const img = await bytesToRgba(bytes);
  if (!img.width || !img.height) throw new Error("图片尺寸无效");

  const r = await scanRgba(img.data, img.width, img.height, { budgetMs: p.budgetMs, formats: p.formats });

  if (p.report) {
    // 报告口径：成/败都返回完整诊断汇总（失败原因不再只留最后一条）
    return renderDiagReport(r.diag, r.ok ? r.result : null);
  }
  if (r.ok) return r.result.text;
  throw r.error;
}

// ============================================================
// 合并入口：图片 → 扫描（qrScanImage 全契约）；文本矩阵 → 结构解析（qrParseOp）。
// 判别规则（顺序即优先级）：① 非字符串 → 图片；② 带图片魔数签名（dataURL 前缀 /
// iVBOR、R0lGO、/9j/、Qk、UklGR base64 头 / 89504e47、47494638、ffd8ff、424d、52696666
// hex 魔数 / 解码后带魔数的 base64，覆盖换行包裹）→ 图片；③ ≥7 非空行且宽 ≥7（与
// parseAsciiMatrix 准入逐字一致）→ 解析；④ 其余 → 解析口径报错（单行 blob 的两旧行为择优）。
// ============================================================
const IMG_B64_PREFIX = /^(iVBOR|R0lGO|\/9j\/|Qk|UklGR)/;
const IMG_HEX_MAGIC = /^(89504e47|47494638|ffd8ff|424d|52696666)/i;

function hasImageMagicBytes(b) {
  if (!b || b.length < 8) return false;
  const png = b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
  const gif = b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46;
  const jpg = b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  const bmp = b[0] === 0x42 && b[1] === 0x4d;
  const riff = b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46;
  return png || gif || jpg || bmp || riff;
}

function isImageInput(input) {
  if (typeof input !== "string") return true;
  const s = input.trim();
  if (/^data:image\//i.test(s)) return true;
  const t = s.replace(/\s+/g, "");
  if (IMG_B64_PREFIX.test(t)) return true;
  if (/^[0-9a-fA-F]+$/.test(t) && t.length % 2 === 0 && IMG_HEX_MAGIC.test(t)) return true;
  try {
    if (hasImageMagicBytes(b64ToBytes(t))) return true;
  } catch { /* 非 base64 → 不是图片字节 */ }
  return false;
}

function isMatrixInput(input) {
  const lines = String(input).replace(/\r/g, "").split("\n").filter((l) => l.length > 0);
  if (lines.length < 7) return false;
  const width = Math.max(...lines.map((l) => l.length));
  return width >= 7;
}

/** 合并后的单入口：图片 → 扫描（qrScanImage 全契约，含 report/budgetMs）；矩阵 → 结构解析（qrParseOp）。 */
function qrScanUnified(input, p = {}) {
  // acceptsBytes 约定：拖入/选择文件的**真字节**在 p.rawBytes，输入框里只是占位文案。
  // 统一入口必须先规范化 rawBytes 再分图像/文本，否则单 op 拖图会被当矩阵解析而报
  // 「无法解析为矩阵」。有 rawBytes 时无条件走图像扫描（它就是图片字节）。
  const rb = p && p.rawBytes && p.rawBytes.length ? p.rawBytes : null;
  if (rb) return qrScanImage(rb, p);
  if (isImageInput(input)) return qrScanImage(input, p);
  return qrParseOp(input);
}

// ============================================================
// 注册
// ============================================================
register({
  id: "qrScanImage",
  cat: "image",
  family: "qr",
  familyLabel: "scan",
  name: "二维码扫描解析",
  desc: "二维码一个入口全包：粘贴图片自动扫描，粘贴文本矩阵自动解析。图片（PNG/JPEG/GIF/BMP/WebP）解出内容；0/1 矩阵或 ASCII art 给出版本/纠错级/掩码/finder 体检。定位符被抹掉或遮挡也能解（网格重建 + 穷举 + 擦除纠错）。「读码范围」放开后可一并读出图中的条码（Code128/EAN/UPC/ITF 等）与 DataMatrix/PDF417/Aztec，多枚符号在诊断报告里逐个列出；勾「诊断报告」失败时给出卡在哪一步与建议。全程本地计算。",
  acceptsBytes: true,
  params: [
    { key: "report", label: "诊断报告", type: "bool", default: false },
    { key: "budgetMs", label: "单张时间预算(ms)", type: "number", default: 8000 },
    { key: "formats", label: "读码范围", type: "select", default: "qr",
      options: [
        { value: "qr", label: "仅二维码（默认）" },
        { value: "qr_linear", label: "二维码 + 线性条码" },
        { value: "all", label: "全部可读格式（含 DataMatrix/PDF417/Aztec）" },
      ] },
  ],
  run: qrScanUnified,
});

export { qrScanImage, qrScanUnified, isImageInput, isMatrixInput, scanGray, scanGrayDiag, toBytes, rgbaToGray };