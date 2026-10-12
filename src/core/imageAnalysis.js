/*
 * imageAnalysis.js — 图片文件自动智能分析。
 *
 * 定位：拖入图片文件 → 智能识别二维码内容（fileAnalysis.js 没有的能力）。
 * 本模块只产出 {sections:[...]}，由 main.js handleFile 按 report.ext 分派调用、合并进报告。
 *
 * 复用（单向依赖，不修改复用件）：
 * ./lsbExtract.js decodePngPixels(bytes) / decodeBmpPixels(bytes)
 * → {width,height,channels,samples:Uint8Array,colorType,depth}
 * | {unsupported:原因} | null
 * （自包含 PNG/BMP 解码，不经 canvas，core 层零 UI 依赖）
 * ./qrdecode.js qrDecodeMatrix(matrix, w, h)
 * → {text, version, size, ecl, mask, finders, errorCount, ...}
 * （0/1 二维数组 → 原文；matrix[y][x]=1 表黑/暗模块，约定见
 * qrcode.js parseAsciiMatrix 的 DARK 集合：1/■/█/# → 1）
 *
 * 算法链路：
 * 图片字节 → decodePngPixels/decodeBmpPixels 像素样本 →
 * 亮度二值化（0.299R+0.587G+0.114B 或灰度/索引值 < 阈值 → 1 黑）→
 * 降采样（像素块多数票 → 模块矩阵；图片像素 ≠ QR 模块，须缩到 21+4k）→
 * qrDecodeMatrix（finder 检测 + 格式信息 + RS 纠错 + 段解码）→
 * section（含 actions：view 双击查看 / download 下载文本；flag 单独 alert 段）。
 *
 * 多阈值 + 反色尝试：标准 QR 是白底黑码，但 CTF 样本可能反色或非纯黑白
 * 故对阈值 128/64/96/160/192 × 正/反色 各试一次，首个成功即返回。
 *
 * 限制：
 * - 仅 PNG / BMP 像素级支持（复用件能力边界）。JPEG / GIF / WEBP 无自包含
 * 解码器，返回 null（不硬编，不调 canvas）。
 * - PNG 索引色（colorType 3）samples 是调色板索引而非 RGB，二值化用索引值
 * 近似（索引 0 多为白但非保证），可能不准；多阈值 + 反色尝试能部分缓解。
 * - 「整图即 QR」识别；QR 嵌在大图任意位置需区域定位（finder 检测 + 透视
 * 校正），复杂度高，本卡不做，非正方形图产 info 提示。
 *
 * 约束：
 * - 复用 lsbExtract / qrdecode 的具名导出，不重写、不反向修改。
 * - core 层零 UI 依赖；section schema 遵守固定契约（含 actions）。
 */

import { decodePngPixels, decodeBmpPixels } from "./lsbExtract.js";
import { qrDecodeMatrix } from "./qrdecode.js";
import { getOp } from "./registry.js";
// 宽高修复直出下载要用到这三个 op。显式副作用导入，保证不依赖 main.js 的导入顺序
// （否则单独引用本模块（测试/Worker）时 getOp 会拿不到，静默退化成一个下载卡片都没有）。
import "./imagefix.js";        // pngSizeRecover / bmpSizeRecover
import { jpegParse, countMcus } from "./jpgSizeRecover.js"; // jpgSizeRecover + 判别用
// JPEG / GIF 走浏览器 canvas 解码（PNG/BMP 无需，走上面自包含解码）。
// decodeToPixelFrames → { mime, frames:[decoded,...], total } | null
// decoded 与 decodePngPixels 同契约 {width,height,channels,samples,...}。
import { decodeToPixelFrames } from "./canvasDecode.js";
// 工业级读码链（ZXing-C++ WASM + 自研几何链）：真实拍摄图/透视/旋转/反色/多符号/
// 半色调的通用检测。与工具页扫码**同一条链**（qrscan.scanRgba），保证两入口结论一致。
import { scanRgba } from "./qrscan.js";

// flag 正则（照 section schema 契约，冻结）
const FLAG_RE = /(flag|ctf|key)\{[^}]+\}/i;

// 合法 QR 模块尺寸：21+4k，k=0..40 → 21..177
const QR_MIN_SIZE = 21;
const QR_MAX_SIZE = 177;

// ------------------------------------------------------------
// 像素 → 0/1 矩阵（亮度二值化）
// ------------------------------------------------------------
// channels>=3 走 Rec.601 亮度；灰度/索引(channels<=1)直接取样本值。
// lum < threshold → 1（黑/暗模块），否则 0。invert=true 时翻转。
function binarize(decoded, threshold, invert) {
  const { width, height, channels, samples } = decoded;
  const mat = new Array(height);
  for (let y = 0; y < height; y++) {
    const row = new Array(width);
    const baseY = y * width * channels;
    for (let x = 0; x < width; x++) {
      const base = baseY + x * channels;
      let lum;
      if (channels >= 3) {
        lum = 0.299 * samples[base] + 0.587 * samples[base + 1] + 0.114 * samples[base + 2];
      } else {
        lum = samples[base];
      }
      let v = lum < threshold ? 1 : 0;
      if (invert) v ^= 1;
      row[x] = v;
    }
    mat[y] = row;
  }
  return mat;
}

// 像素级矩阵降采样到模块矩阵：每 N×N 像素块取多数票（dark*2 >= total → 1）。
// K % M !== 0 时返回 null（不整除不硬凑）。N===1 时直接返回原矩阵（像素即模块）。
function downsample(pixelMat, K, M) {
  if (K === M) return pixelMat;
  if (K < M || K % M !== 0) return null;
  const N = K / M;
  const out = new Array(M);
  for (let my = 0; my < M; my++) {
    const row = new Array(M);
    for (let mx = 0; mx < M; mx++) {
      let dark = 0;
      const total = N * N;
      for (let dy = 0; dy < N; dy++) {
        const py = my * N + dy;
        for (let dx = 0; dx < N; dx++) {
          dark += pixelMat[py][mx * N + dx];
        }
      }
      row[mx] = dark * 2 >= total ? 1 : 0;
    }
    out[my] = row;
  }
  return out;
}

// 裁掉均匀边缘（quiet zone）。标准 QR quiet zone 全白（binarize 后全 0）
// 反色 QR quiet zone 全黑（全 1）。从四边向内裁，遇首个非均匀行/列即停。
// 返回 {mat, w, h} 或 null（全图均匀）。裁后若非正方形由调用方判。
function trimUniformEdges(mat, K) {
  let top = 0, bottom = K - 1, left = 0, right = K - 1;
  const rowUniform = (y) => {
    const r = mat[y], f = r[0];
    for (let x = 1; x < K; x++) if (r[x] !== f) return false;
    return true;
  };
  const colUniform = (x) => {
    const f = mat[0][x];
    for (let y = 1; y < K; y++) if (mat[y][x] !== f) return false;
    return true;
  };
  while (top < bottom && rowUniform(top)) top++;
  while (bottom > top && rowUniform(bottom)) bottom--;
  while (left < right && colUniform(left)) left++;
  while (right > left && colUniform(right)) right--;
  const w = right - left + 1, h = bottom - top + 1;
  if (w <= 0 || h <= 0) return null;
  if (left === 0 && top === 0 && right === K - 1 && bottom === K - 1) {
    return { mat, w: K, h: K };
  }
  const out = new Array(h);
  for (let y = 0; y < h; y++) out[y] = mat[top + y].slice(left, left + w);
  return { mat: out, w, h };
}

// 任意宽高版裁边（非方形载体：矩形留白时各边独立收缩）。
// 与 trimUniformEdges 同口径：按轴从四边向内裁均匀行/列。
function trimUniformEdgesWH(mat, W, H) {
  let top = 0, bottom = H - 1, left = 0, right = W - 1;
  const rowUniform = (y) => {
    const r = mat[y], f = r[0];
    for (let x = 1; x < W; x++) if (r[x] !== f) return false;
    return true;
  };
  const colUniform = (x) => {
    const f = mat[0][x];
    for (let y = 1; y < H; y++) if (mat[y][x] !== f) return false;
    return true;
  };
  while (top < bottom && rowUniform(top)) top++;
  while (bottom > top && rowUniform(bottom)) bottom--;
  while (left < right && colUniform(left)) left++;
  while (right > left && colUniform(right)) right--;
  const w = right - left + 1, h = bottom - top + 1;
  if (w <= 0 || h <= 0) return null;
  if (left === 0 && top === 0 && right === W - 1 && bottom === H - 1) {
    return { mat, w: W, h: H };
  }
  const out = new Array(h);
  for (let y = 0; y < h; y++) out[y] = mat[top + y].slice(left, left + w);
  return { mat: out, w, h };
}

// 最近邻重采样到 L×L（有界候选，配合 finder/格式/纠错校验淘汰错解）。
// R 为超采样倍数：先重采样到 (L·R)×(L·R) 再 R×R 多数降采样——非整数节距
// 拉伸下最近邻单采样会踩模块边缘，4x 超采样实测可归零错位（）。
function resampleSquareNN(mat, W, H, L, R = 1) {
  const N = L * R;
  const hi = new Array(N);
  for (let y = 0; y < N; y++) {
    const sy = Math.min(H - 1, Math.floor(y * H / N));
    const srcRow = mat[sy];
    const row = new Array(N);
    for (let x = 0; x < N; x++) row[x] = srcRow[Math.min(W - 1, Math.floor(x * W / N))];
    hi[y] = row;
  }
  if (R === 1) return hi;
  const need = (R * R) / 2;
  const out = new Array(L);
  for (let y = 0; y < L; y++) {
    const row = new Array(L);
    for (let x = 0; x < L; x++) {
      let s = 0;
      for (let dy = 0; dy < R; dy++) for (let dx = 0; dx < R; dx++) s += hi[y * R + dy][x * R + dx];
      row[x] = s >= need ? 1 : 0;
    }
    out[y] = row;
  }
  return out;
}

// 枚举候选模块尺寸 M：优先 K 的整除因子中合法的 21+4k；若无，K 本身合法也列入。
function candidateModules(K) {
  const list = [];
  for (let M = QR_MIN_SIZE; M <= QR_MAX_SIZE && M <= K; M += 4) {
    if (K % M === 0) list.push(M);
  }
 // K 本身是合法模块数（像素即模块）且未因整除加入
  if (K >= QR_MIN_SIZE && K <= QR_MAX_SIZE && (K - 17) % 4 === 0) {
    if (!list.includes(K)) list.push(K);
  }
  return list;
}

// 多阈值 × 反色 × 候选M 尝试解码，首个成功返回结果；全失败返回 null。
// 流程：二值化 → 裁均匀边缘(quiet zone) → 候选模块尺寸 → 降采样 → qrDecodeMatrix。
// 非方形载体：按轴裁边后，对每个合法模块数 M 直接最近邻重采样为 M×M
//（每模块一投，拉伸把模块节距拉齐；最多 40 投×2 反色×5 阈值，有界），
// 靠解码端 finder/格式/纠错校验淘汰错解，不额外穷举。
function tryDecodeQr(decoded) {
  const W = decoded.width, H = decoded.height;
  const square = W === H;
  if (!square && (W < 21 || H < 21)) return null; // 非方且短边不足最小 QR

  const thresholds = [128, 64, 96, 160, 192];
  for (const th of thresholds) {
    for (const invert of [false, true]) {
      const pixelMat = binarize(decoded, th, invert);
      const trimmed = square
        ? trimUniformEdges(pixelMat, W)
        : trimUniformEdgesWH(pixelMat, W, H);
      if (!trimmed) continue;
      if (trimmed.w === trimmed.h) {
        const K2 = trimmed.w;
        for (const M of candidateModules(K2)) {
          const modMat = downsample(trimmed.mat, K2, M);
          if (!modMat) continue;
          try {
            return qrDecodeMatrix(modMat, M, M);
          } catch (_) {
 // 该组合失败，继续尝试下一个
          }
        }
        continue;
      }
      if (square) continue; // 裁后失去正方形 → 此阈值/反色组合不适用
      const { mat: tm, w: TW, h: TH } = trimmed;
      const bigSide = Math.max(TW, TH);
      for (let M = QR_MIN_SIZE; M <= QR_MAX_SIZE && M <= bigSide; M += 4) {
        const sq = resampleSquareNN(tm, TW, TH, M, 4);
        try {
          return qrDecodeMatrix(sq, M, M);
        } catch (_) {
 // 拉伸候选失败，继续
        }
      }
    }
  }
  return null;
}

// UTF-8 字符串 → 字节数组（download action 用）
function utf8Bytes(str) {
  return Array.from(new TextEncoder().encode(str));
}

// 判断文本是否含大量控制字符 / 过长，需提供下载
function needDownload(text) {
  if (text.length > 200) return true;
  return /[\x00-\x08\x0e-\x1f]/.test(text);
}

// ------------------------------------------------------------
// 拖入图片的「智能识别二维码」主路径：**与工具页扫码同一条链**（qrscan.scanRgba）。
// 既有 tryDecodeQr 只做「整图即 QR」的整数降采样，真实拍摄图 / 嵌在大图里的码一律
// 识别不到；这里改用统一链——ZXing 工业级检测器优先（任意位置、透视、旋转、反色、
// 多符号、半色调），未命中再走自研链路（定位符缺失 / 遮挡擦除 / 非整节距）。
// 两条入口同链 ⇒ 拖进来与粘进工具页结论一致。
// ------------------------------------------------------------

/** 拖入路径单帧扫描预算（ms）：文件报告要即时反馈，故比工具页默认 8s 收紧。 */
const DRAGIN_SCAN_BUDGET_MS = 4000;

/** decoded（decodePngPixels/decodeBmpPixels/canvas 帧契约）→ RGBA（读码器只吃 4 字节/像素）。 */
function decodedToRgba(decoded) {
  const { width: w, height: h, channels: ch, samples: s } = decoded;
  if (!w || !h || !s) return null;
  const out = new Uint8ClampedArray(w * h * 4);
  if (ch >= 4) {
    for (let i = 0, j = 0; j < w * h; i += ch, j++) {
      out[j * 4] = s[i]; out[j * 4 + 1] = s[i + 1]; out[j * 4 + 2] = s[i + 2]; out[j * 4 + 3] = 255;
    }
  } else if (ch === 3) {
    for (let i = 0, j = 0; j < w * h; i += 3, j++) {
      out[j * 4] = s[i]; out[j * 4 + 1] = s[i + 1]; out[j * 4 + 2] = s[i + 2]; out[j * 4 + 3] = 255;
    }
  } else {
    // 灰度 / 索引色：按灰度铺满三通道（索引色近似，与既有二值化口径一致）
    for (let j = 0; j < w * h; j++) {
      const v = s[j];
      out[j * 4] = v; out[j * 4 + 1] = v; out[j * 4 + 2] = v; out[j * 4 + 3] = 255;
    }
  }
  return out;
}

/** 统一构造「二维码识别」段（+ flag 段）。extra = 该符号的附加说明（引擎/版本/纠错级…）。 */
function qrSectionFor(text, extra, name, frame, srcW, srcH, tagSuffix) {
  const sections = [];
  const frameTag = frame ? "（第 " + (frame.index + 1) + "/" + frame.total + " 帧）" : "";
  const tag = (frame ? "-f" + frame.index : "") + (tagSuffix || "");
  const hasFlag = FLAG_RE.test(text);
  const lines = [
    "识别到 QR 码" + frameTag + "（" + extra + "）",
    "尺寸: " + srcW + "×" + srcH + " 像素源图",
    "内容: " + (text === "" ? "(空)" : text),
    "（双击卡片查看完整内容）",
  ];
  const actions = [];
  if (text !== "") {
    actions.push({ type: "view", label: "双击查看", text });
    if (needDownload(text)) {
      const base = (name || "qr").replace(/\.[^.]+$/, "") || "qr";
      actions.push({
        type: "download",
        label: "下载文本",
        filename: base + "_qr" + tag + ".txt",
        mime: "text/plain",
        bytes: utf8Bytes(text),
      });
    }
  }
  sections.push({
    id: "img-qr" + tag,
    title: "二维码识别" + (frame ? " " + frameTag : ""),
    level: hasFlag ? "alert" : "info",
    icon: "qr_code",
    body: lines.join("\n"),
    actions,
  });
  if (hasFlag) {
    const m = text.match(FLAG_RE);
    sections.push({
      id: "img-qr-flag" + tag,
      title: "flag",
      level: "alert",
      icon: "emergency",
      body: "识别到 flag" + frameTag + ":\n" + m[0],
    });
  }
  return sections;
}

/** 自研链路 result → 段说明行（字段与报告口径同形）。 */
function legacyExtraOf(r) {
  const ecl = (typeof r.ecl === "number") ? ["L", "M", "Q", "H"][r.ecl] : (r.ecl || "-");
  return "自研链路 " + r.via + "，版本 v" + r.version + " " + r.size + "×" + r.size +
    "，" + ecl + "，掩码 " + r.mask + (r.errorCount != null ? "，RS 纠错 " + r.errorCount + " 处" : "");
}

/** 对图片字节跑统一扫描链，返回 section 数组（无命中/引擎不可用 → []）。 */
async function unifiedQrSections(bytes, name) {
  const sections = [];
  let frames = null;
  const png = decodePngPixels(bytes) || decodeBmpPixels(bytes);
  if (png && !png.unsupported) frames = [{ decoded: png, info: null }];
  if (!frames) {
    let pack = null;
    try { pack = await decodeToPixelFrames(bytes); } catch { pack = null; }
    if (pack && pack.frames && pack.frames.length) {
      const multi = pack.total > 1 || pack.frames.length > 1;
      frames = pack.frames.map((f, i) => ({ decoded: f, info: multi ? { index: i, total: pack.total } : null }));
    }
  }
  if (!frames) return sections;
  for (const { decoded, info } of frames) {
    const rgba = decodedToRgba(decoded);
    if (!rgba) continue;
    let r = null;
    try { r = await scanRgba(rgba, decoded.width, decoded.height, { budgetMs: DRAGIN_SCAN_BUDGET_MS }); } catch { r = null; }
    if (!r || !r.ok) continue;
    const W = decoded.width, H = decoded.height;
    if (r.zxHits && r.zxHits.length) {
      const n = r.zxHits.length;
      for (let i = 0; i < n; i++) {
        const h = r.zxHits[i];
        const v = parseInt(h.version, 10);
        const hasV = Number.isFinite(v) && v >= 1 && v <= 40;
        const extra = (h.format || "QRCode") + (h.ecLevel ? " " + h.ecLevel : "") +
          (hasV ? "，版本 v" + v + " " + (17 + 4 * v) + "×" + (17 + 4 * v) + " 模块" : "") +
          (h.isInverted ? "，反色" : "") + (h.isMirrored ? "，镜像" : "") +
          (n > 1 ? "，第 " + (i + 1) + "/" + n + " 个符号" : "");
        for (const s of qrSectionFor(h.text || "", extra, name, info, W, H, n > 1 ? "-s" + i : "")) sections.push(s);
      }
    } else if (r.result) {
      for (const s of qrSectionFor(r.result.text || "", legacyExtraOf(r.result), name, info, W, H, "")) sections.push(s);
    }
  }
  return sections;
}

// ------------------------------------------------------------
// 单帧像素 → QR section 数组（PNG/BMP/JPEG/GIF 共用同一管线）。
// decoded: {width,height,channels,samples,...}（decodePngPixels 契约）
// name: 文件名（download filename 用）
// frame: 多帧时 {index,total} → id/title 加帧号并抑制无 QR 的噪声段；
// 单帧传 null。
// skipQr: true 表示 ZXing 层已给出二维码结论，本层不再重复尝试（避免自相矛盾）。
// 返回 section 数组（可能为空）。
// ------------------------------------------------------------
function buildQrSections(decoded, name, frame, skipQr) {
  const sections = [];
  const suffix = frame ? "-f" + frame.index : "";
  const frameTag = frame ? "（第 " + (frame.index + 1) + "/" + frame.total + " 帧）" : "";
  if (skipQr) return sections;

  if (true) {
    const qr = tryDecodeQr(decoded);
    if (qr) {
      const stretched = decoded.width !== decoded.height;
      const text = qr.text || "";
      const hasFlag = FLAG_RE.test(text);
      const lines = [
        "识别到 QR 码" + frameTag + "（版本 v" + qr.version + " " + qr.ecl + "，掩码 " + qr.mask + "，RS 纠错 " + qr.errorCount + " 处）",
        "尺寸: " + qr.size + "×" + qr.size + " 模块（源图 " + decoded.width + "×" + decoded.height + " 像素" + (stretched ? "，非方形已拉伸恢复" : "") + "）",
        "内容: " + (text === "" ? "(空)" : text),
        "（双击卡片查看完整内容）",
      ];
      const actions = [];
      if (text !== "") {
        actions.push({ type: "view", label: "双击查看", text });
        if (needDownload(text)) {
          const base = (name || "qr").replace(/\.[^.]+$/, "") || "qr";
          actions.push({
            type: "download",
            label: "下载文本",
            filename: base + "_qr" + suffix + ".txt",
            mime: "text/plain",
            bytes: utf8Bytes(text),
          });
        }
      }
      sections.push({
        id: "img-qr" + suffix,
        title: "二维码识别" + (frame ? " " + frameTag : ""),
        level: hasFlag ? "alert" : "info",
        icon: "qr_code",
        body: lines.join("\n"),
        actions,
      });
      if (hasFlag) {
        const m = text.match(FLAG_RE);
        sections.push({
          id: "img-qr-flag" + suffix,
          title: "flag",
          level: "alert",
          icon: "emergency",
          body: "识别到 flag" + frameTag + ":\n" + m[0],
        });
      }
  } else if (!frame) {
 // 未解出（含非方形）：仅单帧提示；多帧逐帧提示会刷屏，故 frame 时静默
    sections.push({
      id: "img-qr" + suffix,
      title: "二维码识别",
      level: "info",
      icon: "qr_code",
      body:
        "未识别到 QR 码。图片为 " + decoded.width + "×" + decoded.height +
        (decoded.width !== decoded.height
          ? "（非正方形）。已尝试整图拉伸恢复（横/纵两向），仍失败。"
          : "。") +
        "本预览已走与「二维码扫描解析」相同的识别链（ZXing 引擎 + 定位校正 + 反色 + 擦除纠错）。仍解不出时可：① 确认二维码占比过小或遮挡超过纠错容量；② 裁出二维码区域单独拖入「二维码扫描解析」再试；③ 若为变形/融合图，见该 op 科普卡的能力边界说明。",
    });
  }
  }
  return sections;
}

// ------------------------------------------------------------
// 颜色频率统计 + 稀有色像素提取
// ------------------------------------------------------------
// CTF 像素颜色隐写刚需：背景一种色占绝大多数，flag 用另一种/几种稀有色
// 的像素点构成文字或图案。统计各颜色频次排序，对非最高频的前几种色各生成
// 分布点阵图，肉眼即可看出是否藏文字/图案。
// decoded: {width,height,channels,samples}（RGBA 忽略 alpha，灰度/索引取样本值）
function _colorKeyOf(samples, base, channels) {
  if (channels >= 3) return ((samples[base] << 16) | (samples[base + 1] << 8) | samples[base + 2]) >>> 0;
  return samples[base];
}
function _colorKeyToStr(key, channels) {
  if (channels >= 3) return "#" + ((key >>> 0) & 0xffffff).toString(16).padStart(6, "0").toUpperCase();
  return "灰度/索引 " + key;
}
// 某颜色的像素分布降采样点阵（█=该色，空格=其他），限制 ≤ 96×64。
function _colorPixelMap(decoded, targetKey, maxW = 96, maxH = 64) {
  const { width, height, channels, samples } = decoded;
  const sx = Math.max(1, Math.ceil(width / maxW));
  const sy = Math.max(1, Math.ceil(height / maxH));
  const outW = Math.ceil(width / sx), outH = Math.ceil(height / sy);
  const rows = [];
  for (let by = 0; by < outH; by++) {
    let line = "";
    for (let bx = 0; bx < outW; bx++) {
      let hit = false;
      for (let y = by * sy; y < Math.min((by + 1) * sy, height) && !hit; y++) {
        for (let x = bx * sx; x < Math.min((bx + 1) * sx, width) && !hit; x++) {
          const base = (y * width + x) * channels;
          if (_colorKeyOf(samples, base, channels) === targetKey) hit = true;
        }
      }
      line += hit ? "█" : " ";
    }
    rows.push(line);
  }
  return rows.join("\n");
}
function buildColorFreqSections(decoded, name, frameInfo) {
  const { width, height, channels, samples } = decoded;
  const total = width * height;
  if (!total || !samples || !channels) return [];
  const prefix = frameInfo ? "帧#" + (frameInfo.index + 1) + " " : "";
  const MAX_COLORS = 4096; // 超过视为连续色调/照片，颜色隐写无意义
  const freq = new Map();
  let tooMany = false;
  for (let i = 0; i < total; i++) {
    const key = _colorKeyOf(samples, i * channels, channels);
    freq.set(key, (freq.get(key) || 0) + 1);
    if (freq.size > MAX_COLORS) { tooMany = true; break; }
  }
  if (tooMany) {
    return [{
      id: "img-colorfreq",
      title: prefix + "颜色频率统计",
      level: "info",
      icon: "palette",
      body: "颜色种类超过 " + MAX_COLORS + "（连续色调/照片）。颜色隐写通常针对纯色块图，此处不做稀有色像素提取。",
    }];
  }
  const sorted = [...freq.entries()].sort((a, b) => b[1] - a[1]);
  const tableLines = sorted.slice(0, 20).map(([k, n], i) =>
    (i + 1) + ". " + _colorKeyToStr(k, channels) + "  " + n + "  " + (n / total * 100).toFixed(2) + "%");
  const secs = [{
    id: "img-colorfreq",
    title: prefix + "颜色频率统计",
    level: "info",
    icon: "palette",
    body: "共 " + freq.size + " 种颜色 / " + total + " 像素（" + width + "×" + height + "）\n序号 颜色 像素数 占比\n" +
      tableLines.join("\n") + (sorted.length > 20 ? "\n…（还有 " + (sorted.length - 20) + " 种）" : ""),
  }];
  return secs;
}

// ------------------------------------------------------------
// 主入口：analyzeImage(bytes, name, detected)
// bytes: Uint8Array / number[]
// name: 文件名（生成 download filename 用）
// detected: 可选，fileAnalysis 的 detected 对象({ext}) 或 ext 字符串 或 null
// 本模块不强依赖 detected，内部用 lsbExtract 的 magic 判断自探
// 返回 { sections:[...] } | null（null = 非图片或不支持，调用方应忽略）
// ------------------------------------------------------------
// ------------------------------------------------------------
// 宽高修复直出下载（拖入即得可下载文件）。
//
// 背景：PNG/BMP/JPEG 三个宽高修复 op 早已按产物协议返回 {text, files}，
// 但那只在「选中该 op 再点转换」时生效；用户直接拖文件进来走的是本模块，
// 于是只看到一段报告、拿不到修复后的文件，还得自己从 base64 行里拷。
// 这里补上拖入路径：调用已注册的修复 op，命中就产出一张带下载按钮的卡片。
//
// 用 getOp 调现用实现而不是复制算法，保证与 op 路径逐字节同一份逻辑。
// ------------------------------------------------------------
const SIZE_RECOVER_OPS = [
  ["pngSizeRecover", "PNG 宽高修复"],
  ["bmpSizeRecover", "BMP 宽高修复"],
  ["jpgSizeRecover", "JPEG 宽高修复"],
];

// JPEG 的自动模式对**任何**高度非 MCU 对齐的正常照片都会算出「真实高度」比记录值大
// 若干行（末尾补齐行），若不加判别，拖入一张普通照片就会弹一张「宽高修复」告警卡 ——
// 那是误报。真实篡改的差值远大于一个 MCU 行，故用「差值 > 一个 MCU 行」当判别门槛：
// 判不出来（渐进式 / 非标准）时交给 op 自己决定。
function jpegSizeChangeIsMeaningful(bytes) {
  let parsed;
  try { parsed = jpegParse(bytes); } catch (_) { return false; } // 非 JPEG → 交给其他 op
  const sof = parsed.sof;
  if (!sof || !sof.baseline) return true; // 非基线交给 op（它会给出提示文案，无产物）
  const trueH = countMcus(bytes, parsed);
  if (trueH == null) return false;
  const vmax = Math.max(1, ...sof.comps.map((c) => c.v));
  // 一个 MCU 行 = 8×vmax 像素。合法 JPEG 的记录高度只需向上补齐到 MCU 行边界，
  // 故合法差值上限是 8×vmax − 1；达到 8×vmax 说明扫描数据比记录高度多出整整一行以上，
  // 那才是「高度被改小藏内容」的特征。
  return Math.abs(trueH - sof.height) >= 8 * vmax;
}

function buildSizeRecoverSections(bytes, name) {
  const sections = [];
  for (const [opId, title] of SIZE_RECOVER_OPS) {
    const op = getOp(opId);
    if (!op || typeof op.run !== "function") continue;
    if (opId === "jpgSizeRecover" && !jpegSizeChangeIsMeaningful(bytes)) continue;
    let r;
    try {
      r = op.run("", { rawBytes: bytes });
    } catch (_) {
      continue; // 该 op 不吃这种容器（例如 JPEG op 遇 PNG 会按契约抛错）→ 试下一个
    }
    if (!r || typeof r === "string") continue;      // 字符串 = 无需修复/修复失败，无产物
    if (!Array.isArray(r.files) || !r.files.length) continue;
    sections.push({
      id: "img-sizerecover",
      title,
      level: "alert",
      icon: "download",
      body: (r.text || "") +
        "\n\n（已生成修复后的文件，点下方按钮直接下载，不必再从 base64 行手拷。）",
      actions: r.files.map((f) => ({
        type: "download",
        label: "下载 " + f.name,
        filename: f.name,
        mime: f.mime,
        bytes: f.bytes,
      })),
    });
    break; // 一张图只会命中一种容器
  }
  return sections;
}

export function analyzeImage(bytes, name = "", detected, opts) {
  if (!bytes || bytes.length === 0) return null;
  const u8a = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const skipQr = !!(opts && opts.skipQr);

 // 宽高修复优先于像素解码：宽高被改过的图，像素解码本身就会失败，
 // 若放在解码之后就会被 null 早退吞掉——而那恰恰是最需要出修复文件的情况。
  const sizeSections = buildSizeRecoverSections(u8a, name);

 // 像素解码：PNG 优先，再 BMP。两者均自包含 magic 判断。
  let decoded = decodePngPixels(u8a);
  if (!decoded) decoded = decodeBmpPixels(u8a);
  if (!decoded) return sizeSections.length ? { sections: sizeSections } : null; // 非 PNG/BMP → 交给其他分析

 // 像素解码不支持（位深/隔行等）
  if (decoded.unsupported) {
    return {
      sections: [
        ...sizeSections,
        {
          id: "img-qr",
          title: "二维码识别",
          level: "info",
          icon: "qr_code",
          body: "暂不支持该图片的像素解码，无法识别二维码: " + decoded.unsupported,
        },
      ],
    };
  }

 // ---- 二维码识别（核心）----
  const sections = sizeSections.slice();
  for (const s of buildQrSections(decoded, name, null, skipQr)) sections.push(s);
 // ---- 颜色频率统计 + 稀有色像素提取 ----
  for (const s of buildColorFreqSections(decoded, name, null)) sections.push(s);
  return sections.length ? { sections } : null;
}

// ------------------------------------------------------------
// 异步入口：analyzeImageAsync(bytes, name, detected)
// 在 analyzeImage（同步 PNG/BMP）之上补 JPEG / GIF——这两类无自包含解码器
// 须走浏览器 canvas（异步）。分派逻辑：
// - PNG/BMP → 复用同步 analyzeImage（零行为变化）。
// - JPEG/GIF → canvasDecode.decodeToPixelFrames 拿 RGBA 像素帧，逐帧
// 走 buildQrSections（复用 PNG/BMP 已通的 QR/像素分析链）。
// 浏览器 API（createImageBitmap/canvas/ImageDecoder）不可用（如 Node）时
// JPEG/GIF 返回 null，不阻断。
// 返回 Promise<{ sections:[...] } | null>。
// ------------------------------------------------------------
export async function analyzeImageAsync(bytes, name = "", detected) {
  if (!bytes || bytes.length === 0) return null;
  const u8a = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);

  // ---- ① 统一读码链优先（ZXing 工业级检测器 + 自研几何链）----
  const zxSections = await unifiedQrSections(u8a, name);
  const zxHit = zxSections.length > 0;

 // PNG/BMP 走同步自包含解码（保持既有行为不变；ZXing 已命中则抑制其二维码段，避免自相矛盾）。
  const sync = analyzeImage(u8a, name, detected, { skipQr: zxHit });
  if (sync) return { sections: [...zxSections, ...sync.sections] };

 // 走到这里说明不是 PNG/BMP（或 PNG/BMP 像素解码不可用）：先给宽高修复留个机会。
 // jpgSizeRecover 是纯 JS，不依赖 canvas，Node 侧同样可用。
  const sizeSections = buildSizeRecoverSections(u8a, name);

 // JPEG/GIF：canvas 解码到 RGBA 像素帧，逐帧跑 QR 识别。
  let framePack;
  try {
    framePack = await decodeToPixelFrames(u8a);
  } catch (_) {
    framePack = null;
  }
  if (!framePack || !framePack.frames || !framePack.frames.length) {
    const out = [...zxSections, ...sizeSections];
    return out.length ? { sections: out } : null;
  }

  const { mime, frames, total } = framePack;
  const multi = total > 1 || frames.length > 1;
  const sections = [...zxSections, ...sizeSections];
  for (let i = 0; i < frames.length; i++) {
    const frameInfo = multi ? { index: i, total } : null;
    const secs = buildQrSections(frames[i], name, frameInfo, zxHit);
    for (const s of secs) sections.push(s);
    for (const s of buildColorFreqSections(frames[i], name, frameInfo)) sections.push(s);
  }

 // 有帧但一个 QR 都没识别到：给一条 info，说明已解到像素但未见 QR
 // （避免「明明支持却静默无输出」的困惑）。
  if (!sections.length) {
    const fmt = mime === "image/gif" ? "GIF" : "JPEG";
    const frameNote = multi ? "（共 " + total + " 帧" + (frames.length < total ? "，已分析前 " + frames.length + " 帧" : "") + "）" : "";
    sections.push({
      id: "img-qr",
      title: "二维码识别",
      level: "info",
      icon: "qr_code",
      body:
        "已将 " + fmt + " 解码到像素" + frameNote + "，但未识别到整图 QR 码。" +
        "注：canvas 取到的是渲染后 RGB 像素，若隐写藏在 JPEG 原始 DCT 系数中此路无法触及（属进阶，待 WASM）。",
    });
  }

  return sections.length ? { sections } : null;
}

export default { analyzeImage, analyzeImageAsync };
