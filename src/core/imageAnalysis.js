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
// JPEG / GIF 走浏览器 canvas 解码（PNG/BMP 无需，走上面自包含解码）。
// decodeToPixelFrames → { mime, frames:[decoded,...], total } | null
// decoded 与 decodePngPixels 同契约 {width,height,channels,samples,...}。
import { decodeToPixelFrames } from "./canvasDecode.js";

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
function tryDecodeQr(decoded) {
  const K = decoded.width;
  if (decoded.width !== decoded.height) return null;

  const thresholds = [128, 64, 96, 160, 192];
  for (const th of thresholds) {
    for (const invert of [false, true]) {
      const pixelMat = binarize(decoded, th, invert);
      const trimmed = trimUniformEdges(pixelMat, K);
      if (!trimmed) continue;
      if (trimmed.w !== trimmed.h) continue; // 裁后须正方形
      const K2 = trimmed.w;
      const candidates = candidateModules(K2);
      for (const M of candidates) {
        const modMat = downsample(trimmed.mat, K2, M);
        if (!modMat) continue;
        try {
          return qrDecodeMatrix(modMat, M, M);
        } catch (_) {
 // 该组合失败，继续尝试下一个
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
// 单帧像素 → QR section 数组（PNG/BMP/JPEG/GIF 共用同一管线）。
// decoded: {width,height,channels,samples,...}（decodePngPixels 契约）
// name: 文件名（download filename 用）
// frame: 多帧时 {index,total} → id/title 加帧号并抑制无 QR 的噪声段；
// 单帧传 null。
// 返回 section 数组（可能为空）。
// ------------------------------------------------------------
function buildQrSections(decoded, name, frame) {
  const sections = [];
  const suffix = frame ? "-f" + frame.index : "";
  const frameTag = frame ? "（第 " + (frame.index + 1) + "/" + frame.total + " 帧）" : "";

  if (decoded.width === decoded.height) {
    const qr = tryDecodeQr(decoded);
    if (qr) {
      const text = qr.text || "";
      const hasFlag = FLAG_RE.test(text);
      const lines = [
        "识别到 QR 码" + frameTag + "（版本 v" + qr.version + " " + qr.ecl + "，掩码 " + qr.mask + "，RS 纠错 " + qr.errorCount + " 处）",
        "尺寸: " + qr.size + "×" + qr.size + " 模块（源图 " + decoded.width + "×" + decoded.height + " 像素）",
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
    }
  } else if (!frame) {
 // 非正方形图（仅单帧提示；多帧逐帧提示会刷屏，故 frame 时静默）
    sections.push({
      id: "img-qr" + suffix,
      title: "二维码识别",
      level: "info",
      icon: "qr_code",
      body:
        "图片为 " + decoded.width + "×" + decoded.height + "（非正方形）。" +
        "当前仅支持整图即 QR 的识别；QR 嵌在局部区域需定位校正，暂未实现。",
    });
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
  // 稀有色像素提取：跳过最高频（背景），对第 2..5 名各出点阵图
  const extractCount = Math.min(4, sorted.length - 1);
  for (let i = 1; i <= extractCount; i++) {
    const [k, n] = sorted[i];
    secs.push({
      id: "img-colorfreq-" + i,
      title: prefix + "第 " + (i + 1) + " 高频色像素图 " + _colorKeyToStr(k, channels),
      level: "info",
      icon: "grid_on",
      body: "该颜色 " + n + " 像素（" + (n / total * 100).toFixed(2) + "%）的分布点阵（█=该色）。" +
        "CTF 中 flag 常由稀有色像素构成图案/文字：\n\n" + _colorPixelMap(decoded, k),
    });
  }
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
export function analyzeImage(bytes, name = "", detected) {
  if (!bytes || bytes.length === 0) return null;
  const u8a = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);

 // 像素解码：PNG 优先，再 BMP。两者均自包含 magic 判断。
  let decoded = decodePngPixels(u8a);
  if (!decoded) decoded = decodeBmpPixels(u8a);
  if (!decoded) return null; // 非 PNG/BMP → 交给其他分析

 // 像素解码不支持（位深/隔行等）
  if (decoded.unsupported) {
    return {
      sections: [
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
  const sections = buildQrSections(decoded, name, null);
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

 // PNG/BMP 走同步自包含解码（保持既有行为不变）。
  const sync = analyzeImage(u8a, name, detected);
  if (sync) return sync;

 // JPEG/GIF：canvas 解码到 RGBA 像素帧，逐帧跑 QR 识别。
  let framePack;
  try {
    framePack = await decodeToPixelFrames(u8a);
  } catch (_) {
    framePack = null;
  }
  if (!framePack || !framePack.frames || !framePack.frames.length) return null;

  const { mime, frames, total } = framePack;
  const multi = total > 1 || frames.length > 1;
  const sections = [];
  for (let i = 0; i < frames.length; i++) {
    const frameInfo = multi ? { index: i, total } : null;
    const secs = buildQrSections(frames[i], name, frameInfo);
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
