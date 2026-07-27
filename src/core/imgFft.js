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
  let decoded = decodePngPixels(buf);
  if (!decoded) decoded = decodeBmpPixels(buf);
  if (!decoded) return "非 PNG/BMP，或无法解码像素（仅支持 PNG/BMP）。";
  if (decoded.unsupported) return "像素解码不支持：" + decoded.unsupported;

  const maxSize = Math.max(32, Math.min(1024, Number(p.maxSize || 512)));
  const W = pow2Floor(decoded.width, maxSize);
  const H = pow2Floor(decoded.height, maxSize);
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
  // 归一化到 0-255 灰度 → RGBA
  const scale = Math.max(1, Math.min(16, Number(p.scale || 1)));
  const outW = W * scale, outH = H * scale;
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
  cat: "stego",
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
