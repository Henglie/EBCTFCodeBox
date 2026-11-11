/*
 * imgFft.js —— 图像 2D FFT 幅度谱查看器。
 *
 * 背景：
 * CTF「频域隐写」经典套路——图片肉眼正常，但在傅里叶频域幅度谱里藏了 flag
 * 文字/图案（对称亮点/条纹）。标准解法：对图做 2D FFT，取 log 幅度谱，
 * fftshift 把低频移到中心，渲染灰度图即见 flag 现形。补齐频域能力，
 * 我方此前只有 1D 音频 FFT（spectrogram），补齐图像 2D FFT。
 *
 * 覆盖（单向 run，输出 PNG data URL，UI 自动渲染 + 下载）：
 * - imgFft：拖入/粘贴 PNG/BMP → 灰度化 → 重采样到 2 的幂（≤512，行列各自）
 *   → 2D FFT（先对每行 FFT，再对每列 FFT）→ log(1+|F|) 幅度谱 → fftshift
 *   → 归一化到 0-255 灰度 → PNG。
 *
 * 复用：
 * - lsbExtract.decodePngPixels/decodeBmpPixels：自包含 PNG/BMP 像素解码。
 * - mcMap.rgbaToDataURL：手写最小 PNG 编码器。
 * - 本文件自带 radix-2 FFT（与 spectrogram 同款 Cooley-Tukey，纯提取无精度往返问题）。
 *
 * 红线：纯本地纯 JS，零外发。仅 PNG/BMP（复用件能力边界），其它格式返回提示。
 * 纯分析向（只看频域，不嵌入/不还原），无浮点往返精度隐患。
 */
import { register } from "./registry.js";
import { decodePngPixels, decodeBmpPixels } from "./lsbExtract.js";
import { rgbaToDataURL } from "./mcMap.js";
import { checkLimit } from "./limitGuard.js";

const FFT_SAMPLES_SOFT = 16 * 1024 * 1024;
const FFT_SAMPLES_HARD = 64 * 1024 * 1024;
const FFT_SOURCE_SOFT = 16 * 1024 * 1024;
const FFT_SOURCE_HARD = 64 * 1024 * 1024;

function _checkFftSamples(actual, label, params) {
  const n = Number(actual);
  if (!Number.isFinite(n) || n <= FFT_SAMPLES_SOFT) return;
  checkLimit({
    scope: "imgFft.samples",
    actual: n,
    soft: FFT_SAMPLES_SOFT,
    hard: FFT_SAMPLES_HARD,
    params,
    label,
    unit: " 样本",
  });
}

// 源图解压/像素缓冲预算：必须在 decodePngPixels/decodeBmpPixels 之前检查，
// 否则 4097×4096 这类图会先分配上百 MB 再弹确认；超软阈值先确认，超硬上限直接拒绝。
function _checkSourcePixels(header, params) {
  const pixels = header.width * header.height;
  if (!Number.isSafeInteger(pixels) || pixels <= 0) {
    throw new Error(`图像尺寸非法（${header.width}×${header.height}=${pixels} 像素）`);
  }
  checkLimit({
    scope: "imgFft.sourcePixels",
    actual: pixels,
    soft: FFT_SOURCE_SOFT,
    hard: FFT_SOURCE_HARD,
    params,
    label: `源图像 ${header.width}×${header.height}`,
    unit: " 像素",
  });
}

// ============================================================
// 文件头嗅探：先拿宽高/位深/隔行，再决定是否解码整图。
// 仅接受 lsbExtract 实际支持的 PNG（8 位、非隔行、0/2/3/4/6 色彩类型）
// 与 BMP（24/32 位未压缩）。不支持格式在解码前直接拒绝。
// ============================================================
function _u32be(b, o) {
  return ((b[o] * 0x1000000) + ((b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3])) >>> 0;
}
function _u32le(b, o) {
  return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] * 0x1000000)) >>> 0;
}
function _i32le(b, o) { return _u32le(b, o) | 0; }
function _u16le(b, o) { return (b[o] | (b[o + 1] << 8)) >>> 0; }

function _isPng(buf) {
  return buf.length >= 8 &&
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47 &&
    buf[4] === 0x0D && buf[5] === 0x0A && buf[6] === 0x1A && buf[7] === 0x0A;
}

function _sniffPng(buf) {
  // 签名(8) + 长度(4) + 类型(4) + IHDR 数据(13) = 29
  if (buf.length < 29) return { format: "png", unsupported: "PNG 头不完整（缺 IHDR）" };
  const ihdrLen = _u32be(buf, 8);
  const type = String.fromCharCode(buf[12], buf[13], buf[14], buf[15]);
  if (type !== "IHDR" || ihdrLen !== 13) {
    return { format: "png", unsupported: `PNG 首块不是完整 IHDR（${type}，长度 ${ihdrLen}）` };
  }
  const width = _u32be(buf, 16);
  const height = _u32be(buf, 20);
  const bitDepth = buf[24], colorType = buf[25], compression = buf[26], filter = buf[27], interlace = buf[28];
  if (!width || !height) return { format: "png", unsupported: "PNG 宽或高为 0" };
  if (!Number.isSafeInteger(width * height)) {
    return { format: "png", unsupported: `PNG 尺寸非法（${width}×${height}）` };
  }
  if (bitDepth !== 8) return { format: "png", unsupported: `位深 ${bitDepth}（仅支持 8 位，16 位等需先转换）` };
  if (interlace !== 0) return { format: "png", unsupported: "Adam7 隔行 PNG（仅支持非隔行）" };
  if (compression !== 0) return { format: "png", unsupported: `PNG 压缩方法 ${compression}（仅支持 0）` };
  if (filter !== 0) return { format: "png", unsupported: `PNG 过滤方法 ${filter}（仅支持 0）` };
  if (![0, 2, 3, 4, 6].includes(colorType)) {
    return { format: "png", unsupported: `PNG 色彩类型 ${colorType}` };
  }
  return { format: "png", width, height, bitDepth, colorType, interlace };
}

function _sniffBmp(buf) {
  if (buf.length < 54) return { format: "bmp", unsupported: "BMP 头不完整" };
  const dataOff = _u32le(buf, 10);
  const headerSize = _u32le(buf, 14);
  const width = _i32le(buf, 18);
  const rawHeight = _i32le(buf, 22);
  const bpp = _u16le(buf, 28);
  const compression = _u32le(buf, 30);
  if (headerSize < 40) return { format: "bmp", unsupported: `BMP 头大小 ${headerSize}（仅支持 BITMAPINFOHEADER 及以上）` };
  if (compression !== 0) return { format: "bmp", unsupported: `BMP 压缩类型 ${compression}（仅支持未压缩）` };
  if (bpp !== 24 && bpp !== 32) return { format: "bmp", unsupported: `BMP 位深 ${bpp}（仅支持 24/32 位）` };
  if (!width || !rawHeight || width < 0) return { format: "bmp", unsupported: "BMP 宽或高非法" };
  if (dataOff > buf.length) return { format: "bmp", unsupported: `BMP 数据区起点 ${dataOff} 超出文件长度 ${buf.length}` };
  const height = Math.abs(rawHeight);
  if (!Number.isSafeInteger(width * height)) {
    return { format: "bmp", unsupported: `BMP 尺寸非法（${width}×${height}）` };
  }
  return { format: "bmp", width, height, bpp, channels: bpp === 32 ? 4 : 3 };
}

function _sniffImageHeader(buf) {
  if (_isPng(buf)) return _sniffPng(buf);
  if (buf.length >= 2 && buf[0] === 0x42 && buf[1] === 0x4D) return _sniffBmp(buf);
  return null;
}

// radix-2 Cooley-Tukey FFT（原地，re/im 为 Float64Array，长度须 2 的幂）
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i]; re[i] = re[j]; re[j] = tr;
      const ti = im[i]; im[i] = im[j]; im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    const half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < half; k++) {
        const idx = i + k, jdx = i + k + half;
        const vr = re[jdx] * cr - im[jdx] * ci;
        const vi = re[jdx] * ci + im[jdx] * cr;
        re[jdx] = re[idx] - vr; im[jdx] = im[idx] - vi;
        re[idx] += vr;          im[idx] += vi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr; cr = ncr;
      }
    }
  }
}

// 最近的不超过 max 的 2 的幂（下取，至少 2）
function pow2Floor(n, max) {
  let p = 1;
  while (p * 2 <= n && p * 2 <= max) p *= 2;
  return Math.max(2, p);
}

// 灰度亮度（Rec.601），decoded.samples 交错排布
function luminanceGrid(decoded, W, H) {
  const { width, height, channels, samples } = decoded;
  // 最近邻重采样到 W×H
  const g = new Float64Array(W * H);
  for (let y = 0; y < H; y++) {
    const sy = Math.min(height - 1, Math.floor(y * height / H));
    for (let x = 0; x < W; x++) {
      const sx = Math.min(width - 1, Math.floor(x * width / W));
      const base = (sy * width + sx) * channels;
      let lum;
      if (channels >= 3) lum = 0.299 * samples[base] + 0.587 * samples[base + 1] + 0.114 * samples[base + 2];
      else lum = samples[base];
      g[y * W + x] = lum;
    }
  }
  return g;
}

function imgFftRun(text, p = {}) {
  const buf = (p && p.rawBytes && p.rawBytes.length)
    ? (p.rawBytes instanceof Uint8Array ? p.rawBytes : new Uint8Array(p.rawBytes))
    : _b64OrHexToBytes(text);
  if (!buf || !buf.length) {
    return "（空输入）请拖入或粘贴 PNG/BMP 图片（base64/hex）。\n" +
      "对图片做 2D FFT，输出 log 幅度谱（低频居中）。CTF 频域隐写常在幅度谱里藏 flag 文字/图案。";
  }
  // 先读文件头：拿源尺寸/位深/隔行，算目标网格与输出像素，再决定是否解码整图。
  const header = _sniffImageHeader(buf);
  if (!header) return "非 PNG/BMP，或无法解码像素（仅支持 PNG/BMP）。";
  if (header.unsupported) return "像素解码不支持：" + header.unsupported;

  const maxSizeRaw = Number(p.maxSize);
  const maxSize = Number.isFinite(maxSizeRaw) ? Math.max(32, Math.min(1024, Math.floor(maxSizeRaw))) : 512;
  const scaleRaw = Number(p.scale);
  const scale = Number.isFinite(scaleRaw) ? Math.max(1, Math.min(16, Math.floor(scaleRaw))) : 1;

  const W = pow2Floor(header.width, maxSize);
  const H = pow2Floor(header.height, maxSize);
  const outW = W * scale, outH = H * scale;
  if (!Number.isSafeInteger(W * H) || W * H <= 0 || !Number.isSafeInteger(outW * outH) || outW * outH <= 0) {
    return `图像尺寸非法（${header.width}×${header.height} → FFT ${W}×${H} ×${scale}）`;
  }
  _checkFftSamples(W * H, `FFT 网格 ${W}×${H}`, p);
  _checkFftSamples(outW * outH, `FFT 输出 ${outW}×${outH}`, p);
  _checkSourcePixels(header, p);

  const decoded = header.format === "png" ? decodePngPixels(buf, p) : decodeBmpPixels(buf, p);
  if (!decoded) return "非 PNG/BMP，或无法解码像素（仅支持 PNG/BMP）。";
  if (decoded.unsupported) return "像素解码不支持：" + decoded.unsupported;
  if (decoded.width !== header.width || decoded.height !== header.height) {
    throw new Error(`图像头尺寸 ${header.width}×${header.height} 与解码结果 ${decoded.width}×${decoded.height} 不一致，拒绝继续`);
  }
  const gray = luminanceGrid(decoded, W, H);

  // 2D FFT：先对每行做 1D FFT，再对每列做 1D FFT
  const re = new Float64Array(W * H);
  const im = new Float64Array(W * H);
  for (let i = 0; i < W * H; i++) re[i] = gray[i];
  // 行 FFT
  const rowRe = new Float64Array(W), rowIm = new Float64Array(W);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) { rowRe[x] = re[y * W + x]; rowIm[x] = im[y * W + x]; }
    fft(rowRe, rowIm);
    for (let x = 0; x < W; x++) { re[y * W + x] = rowRe[x]; im[y * W + x] = rowIm[x]; }
  }
  // 列 FFT
  const colRe = new Float64Array(H), colIm = new Float64Array(H);
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) { colRe[y] = re[y * W + x]; colIm[y] = im[y * W + x]; }
    fft(colRe, colIm);
    for (let y = 0; y < H; y++) { re[y * W + x] = colRe[y]; im[y * W + x] = colIm[y]; }
  }

  // log 幅度谱 + fftshift（低频移到中心）
  const mag = new Float64Array(W * H);
  let maxLog = 0;
  const hw = W >> 1, hh = H >> 1;
  for (let y = 0; y < H; y++) {
    const sy = (y + hh) % H;
    for (let x = 0; x < W; x++) {
      const sx = (x + hw) % W;
      const si = sy * W + sx;
      const m = Math.log(1 + Math.hypot(re[si], im[si]));
      mag[y * W + x] = m;
      if (m > maxLog) maxLog = m;
    }
  }
  // 归一化到 0-255 灰度 → RGBA（输出尺寸/预算已在解码前算好）
  const rgba = new Uint8Array(outW * outH * 4);
  const inv = maxLog > 0 ? 255 / maxLog : 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const v = Math.round(mag[y * W + x] * inv) & 0xff;
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const px = ((y * scale + dy) * outW + (x * scale + dx)) * 4;
          rgba[px] = v; rgba[px + 1] = v; rgba[px + 2] = v; rgba[px + 3] = 255;
        }
      }
    }
  }
  return rgbaToDataURL(rgba, outW, outH);
}

// base64 或 hex → 字节（拖文件走 rawBytes，此路仅处理粘贴文本）
function _b64OrHexToBytes(text) {
  const s = String(text || "").trim();
  if (!s) return new Uint8Array(0);
  // 纯 hex（含空白）
  const hexClean = s.replace(/\s/g, "");
  if (/^[0-9a-fA-F]+$/.test(hexClean) && hexClean.length % 2 === 0) {
    const out = new Uint8Array(hexClean.length >> 1);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(hexClean.substr(i * 2, 2), 16);
    return out;
  }
  // base64
  try {
    const bin = atob(s.replace(/\s/g, ""));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch { return new Uint8Array(0); }
}

register({
  id: "imgFft",
  cat: "stegoFile",
  name: "图像 2D FFT 幅度谱",
  desc: "对 PNG/BMP 做 2D 傅里叶变换，输出 log 幅度谱（低频居中/fftshift）。CTF 频域隐写常在幅度谱里藏 flag 文字/图案（图片肉眼正常，频域现形）。重采样到 2 的幂（≤maxSize）。",
  params: [
    { key: "maxSize", label: "最大边长（重采样到 2 的幂，32-1024）", type: "number", default: 512 },
    { key: "scale", label: "输出放大倍数", type: "number", default: 1 },
  ],
  run: imgFftRun,
  acceptsBytes: true,
});

export { imgFftRun, fft };
