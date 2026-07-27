/*
 * blindWatermark.js — DCT 盲水印（单图自洽版）。
 *
 * 定位：8×8 分块 DCT + QIM（量化索引调制）文本盲水印。本工具嵌入的图，本工具
 * 能提取（无须原图），是 CTF 盲水印高频题型。互解 Python blind_watermark 库
 * 的 DWT-DCT-SVD 版不在本文件范围。
 *
 * 算法依据：
 * - 2D DCT-II（8×8，可分离）：F = B · f · Bᵀ，B 为正交归一化余弦基矩阵
 * B[u][x] = α(u)·cos((2x+1)uπ/16)，α(0)=√(1/8)，α(u>0)=√(2/8)。
 * 逆变换 f = Bᵀ · F · B（正交阵，逆=转置），完美重建。
 * 等价于经典公式 F(u,v)=¼C(u)C(v)ΣΣf(x,y)cos((2x+1)uπ/16)cos((2y+1)vπ/16)
 * （¼ 与 C 归一化因子被 α 吸收）。
 * - QIM 盲提取：嵌 bit b 时把中频系数量化到奇/偶 bin —— q=round(F/Q)
 * 调 q 奇偶匹配 b，F'=q·Q；提取 b=round(F'/Q) mod 2。只需合成图，真盲。
 * - 中频系数（避开 DC 与高频，抗像素取整噪声/轻压缩）：默认 4 个 u+v=5 的
 * 系数冗余嵌同一 bit，提取时多数投票，抵抗 IDCT→像素取整误差。
 *
 * 数据契约（对齐 stegoImage.js 图像类 op）：
 * encode(imageData:{width,height,data:Uint8ClampedArray}, text, p) → imageData（带水印）
 * decode(imageData, p) → text
 * UI 层 app.js 负责 文件→canvas→imageData→调 op→输出 dataURL(PNG)。
 *
 * core 层零 UI 依赖（仅 import registry）。纯算法部分（dct8x8/idct8x8/qim/
 * embedIntoImageData/decodeFromImageData）可 node 单测（不碰 DOM/canvas）。
 */

import { register } from "./registry.js";

const N = 8;

// 预计算归一化 DCT-II 基矩阵 B[u][x]=α(u)·cos((2x+1)uπ/16)。避免每块重算三角函数。
const DCT_BASIS = (() => {
  const B = [];
  for (let u = 0; u < N; u++) {
    B[u] = new Float64Array(N);
    const alpha = u === 0 ? Math.sqrt(1 / N) : Math.sqrt(2 / N);
    for (let x = 0; x < N; x++) {
      B[u][x] = alpha * Math.cos(((2 * x + 1) * u * Math.PI) / (2 * N));
    }
  }
  return B;
})();

// 默认中频系数（u+v=5，中频折中：避开 DC/低频显痕与高频脆弱）。4 个冗余嵌同 bit。
const DEFAULT_COORDS = [[2, 3], [3, 2], [1, 4], [4, 1]];

// ---- 8×8 2D DCT / IDCT（可分离，纯数组，可 node 测） ----

// block[r][c] → F[u][v] = Σr Σc B[u][r]·block[r][c]·B[v][c]
export function dct8x8(block) {
  const tmp = [];
  for (let u = 0; u < N; u++) {
    tmp[u] = new Float64Array(N);
    for (let c = 0; c < N; c++) {
      let s = 0;
      for (let r = 0; r < N; r++) s += DCT_BASIS[u][r] * block[r][c];
      tmp[u][c] = s;
    }
  }
  const F = [];
  for (let u = 0; u < N; u++) {
    F[u] = new Float64Array(N);
    for (let v = 0; v < N; v++) {
      let s = 0;
      for (let c = 0; c < N; c++) s += tmp[u][c] * DCT_BASIS[v][c];
      F[u][v] = s;
    }
  }
  return F;
}

// F[u][v] → f[r][c] = Σu Σv B[u][r]·F[u][v]·B[v][c]
export function idct8x8(F) {
  const tmp = [];
  for (let r = 0; r < N; r++) {
    tmp[r] = new Float64Array(N);
    for (let v = 0; v < N; v++) {
      let s = 0;
      for (let u = 0; u < N; u++) s += DCT_BASIS[u][r] * F[u][v];
      tmp[r][v] = s;
    }
  }
  const f = [];
  for (let r = 0; r < N; r++) {
    f[r] = new Float64Array(N);
    for (let c = 0; c < N; c++) {
      let s = 0;
      for (let v = 0; v < N; v++) s += tmp[r][v] * DCT_BASIS[v][c];
      f[r][c] = s;
    }
  }
  return f;
}

// ---- QIM ----

// 嵌 bit 到系数：量化到匹配奇偶的最近 bin（朝原值方向移动，减少失真）。
export function qimEmbed(coeff, bit, Q) {
  const r = coeff / Q;
  let q = Math.round(r);
  if ((q & 1) !== (bit & 1)) {
    q = r > q ? q + 1 : q - 1;
  }
  return q * Q;
}

// 提取 bit：看系数落入奇/偶 bin（%2 修正负数）。
export function qimExtract(coeff, Q) {
  const q = Math.round(coeff / Q);
  return ((q % 2) + 2) % 2;
}

// ---- bit / 字节 / 文本 ----

function bytesToBits(bytes) {
  const bits = [];
  for (const b of bytes) for (let i = 7; i >= 0; i--) bits.push((b >> i) & 1);
  return bits;
}

function bitsToBytes(bits) {
  const out = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    let b = 0;
    for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
    out.push(b);
  }
  return new Uint8Array(out);
}

// payload = 32bit 长度头（payload 字节数，大端）+ UTF-8 字节 → bit 流。
function buildPayloadBits(text) {
  const data = new TextEncoder().encode(text);
  const len = data.length;
  const header = new Uint8Array([
    (len >>> 24) & 0xff, (len >>> 16) & 0xff, (len >>> 8) & 0xff, len & 0xff,
  ]);
  return bytesToBits(header).concat(bytesToBits(data));
}

// ---- imageData 通道块 IO ----

function channelOffset(ch) {
  return ch === "R" ? 0 : ch === "G" ? 1 : 2; // 默认 B
}

function readBlock(data, width, off, bx, by) {
  const block = [];
  for (let r = 0; r < N; r++) {
    block[r] = new Float64Array(N);
    for (let c = 0; c < N; c++) {
      const px = (by * N + r) * width + (bx * N + c);
      block[r][c] = data[px * 4 + off];
    }
  }
  return block;
}

function writeBlock(data, width, off, bx, by, f) {
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      const px = (by * N + r) * width + (bx * N + c);
      let v = Math.round(f[r][c]);
      if (v < 0) v = 0;
      else if (v > 255) v = 255;
      data[px * 4 + off] = v;
    }
  }
}

function clampQ(q) {
  const n = Number(q);
  if (!isFinite(n) || n <= 0) return 24;
  return n;
}

// ---- 嵌入 / 提取（纯算法，node 可测；仅依赖 imageData 结构，不碰 DOM） ----

export function embedIntoImageData(imageData, text, Q, ch, coords) {
  const { width, height, data } = imageData;
  const off = channelOffset(ch);
  const bw = Math.floor(width / N);
  const bh = Math.floor(height / N);
  const capacity = bw * bh; // 每块 1 bit
  const bits = buildPayloadBits(text);
  if (bits.length > capacity) {
    throw new Error(
      `水印过长：需 ${bits.length} bit，图像容量仅 ${capacity} bit（${bw}×${bh} 块）。请用更大图或更短文本。`
    );
  }
  let bi = 0;
  for (let by = 0; by < bh && bi < bits.length; by++) {
    for (let bx = 0; bx < bw && bi < bits.length; bx++) {
      const bit = bits[bi++];
      const block = readBlock(data, width, off, bx, by);
      const F = dct8x8(block);
      for (const [u, v] of coords) F[u][v] = qimEmbed(F[u][v], bit, Q);
      writeBlock(data, width, off, bx, by, idct8x8(F));
    }
  }
  return imageData;
}

function extractBits(imageData, count, Q, ch, coords) {
  const { width, height, data } = imageData;
  const off = channelOffset(ch);
  const bw = Math.floor(width / N);
  const bh = Math.floor(height / N);
  const half = coords.length / 2;
  const bits = [];
  for (let by = 0; by < bh && bits.length < count; by++) {
    for (let bx = 0; bx < bw && bits.length < count; bx++) {
      const F = dct8x8(readBlock(data, width, off, bx, by));
      let ones = 0;
      for (const [u, v] of coords) ones += qimExtract(F[u][v], Q);
      bits.push(ones >= half ? 1 : 0); // 多数投票
    }
  }
  return bits;
}

export function decodeFromImageData(imageData, Q, ch, coords) {
  const { width, height } = imageData;
  const capacity = Math.floor(width / N) * Math.floor(height / N);
  const headerBits = extractBits(imageData, 32, Q, ch, coords);
  if (headerBits.length < 32) {
    throw new Error("图像太小，无法容纳水印头（至少需 32 个 8×8 块）");
  }
  const lb = bitsToBytes(headerBits);
  const len = ((lb[0] << 24) | (lb[1] << 16) | (lb[2] << 8) | lb[3]) >>> 0;
  if (len === 0 || 32 + len * 8 > capacity) {
    throw new Error("未检测到有效 DCT 水印（可能强度/通道与嵌入不一致，或该图无水印）");
  }
  const allBits = extractBits(imageData, 32 + len * 8, Q, ch, coords);
  const bytes = bitsToBytes(allBits.slice(32));
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

// ---- (text, p) 适配层：接上 UI 的 acceptsBytes 管线 ----
// 拖入的图片字节走 p.rawBytes（Uint8Array），粘贴的 base64/dataURL 走 text。像素级
// DCT 需要逐像素 RGBA，故用 createImageBitmap 把字节解成位图、画到 canvas 取真 RGBA
// （通吃 PNG/JPG/BMP/GIF）。嵌入方向要藏的文本走参数栏（p.message，单输入框放不下
// 图片+文本两份料）；输出带水印 PNG dataURL（UI 渲染成图）。提取方向直接返回文本。
// 算法本身（embedIntoImageData/decodeFromImageData）一行不改，此处只做搬运。

// 把 base64 / dataURL 文本转字节（粘贴路径用；拖入走 rawBytes 不经此处）。
function _b64ToBytes(s) {
  let str = String(s || "").replace(/\s+/g, "");
  const comma = str.indexOf(",");
  if (comma >= 0 && str.slice(0, 5).toLowerCase() === "data:") str = str.slice(comma + 1);
  let bin;
  if (typeof atob === "function") bin = atob(str);
  else if (typeof Buffer !== "undefined") bin = Buffer.from(str, "base64").toString("binary");
  else throw new Error("无 atob/Buffer，无法解码 base64");
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// 取图片字节：优先拖入的 rawBytes，其次把粘贴文本当 base64/dataURL 试解。
function _imageBytes(text, p) {
  if (p && p.rawBytes && p.rawBytes.length) {
    return p.rawBytes instanceof Uint8Array ? p.rawBytes : new Uint8Array(p.rawBytes);
  }
  const s = String(text == null ? "" : text).trim();
  if (!s) return new Uint8Array(0);
  try { return _b64ToBytes(s); } catch (e) { return new Uint8Array(0); }
}

// 字节 → RGBA ImageData（浏览器 canvas）。不填白底，尽量保留原像素。
async function _decodeToImageData(bytes) {
  if (typeof createImageBitmap !== "function" || typeof document === "undefined") {
    throw new Error("图像解码需要浏览器环境（createImageBitmap/canvas 不可用）");
  }
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bmp;
  try {
    bmp = await createImageBitmap(new Blob([u8]));
  } catch (e) {
    throw new Error("无法解码图片：格式不支持或文件损坏（支持 PNG/JPG/BMP/GIF）");
  }
  const w = bmp.width, h = bmp.height;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bmp, 0, 0);
  if (bmp.close) bmp.close();
  return ctx.getImageData(0, 0, w, h);
}

// ImageData → PNG dataURL。
function _imageDataToDataURL(imageData) {
  if (typeof document === "undefined") {
    throw new Error("图像输出需要浏览器环境（canvas 不可用）");
  }
  const canvas = document.createElement("canvas");
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  const ctx = canvas.getContext("2d");
  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL("image/png");
}

async function _inputImageData(text, p) {
  const bytes = _imageBytes(text, p);
  if (!bytes || !bytes.length) {
    throw new Error("请拖入或粘贴图片文件（支持 PNG/JPG/BMP/GIF）");
  }
  return _decodeToImageData(bytes);
}

async function dctWatermarkEncodeOp(text, p = {}) {
  const imageData = await _inputImageData(text, p);
  const msg = p && p.message != null ? String(p.message) : "";
  if (!msg) throw new Error("请在「水印文本」参数中填入要嵌入的内容");
  const out = embedIntoImageData(imageData, msg, clampQ(p.strength), p.channel || "B", DEFAULT_COORDS);
  return _imageDataToDataURL(out);
}

async function dctWatermarkDecodeOp(text, p = {}) {
  const imageData = await _inputImageData(text, p);
  return decodeFromImageData(imageData, clampQ(p.strength), p.channel || "B", DEFAULT_COORDS);
}

// ---- 注册（图像类 op：拖入图片走 acceptsBytes，UI 把原始字节放进 p.rawBytes） ----

const CHANNEL_OPTIONS = [
  { value: "R", label: "R 通道" },
  { value: "G", label: "G 通道" },
  { value: "B", label: "B 通道（默认）" },
];

// C7-R10 合并：dctWatermarkEmbed/Extract 合成单个双向 op。异构输入（嵌入要图+文本
// 提取只要图）由图像 op 约定承载——encode(imageData,text,p) / decode(imageData,p)
// 与 lsbImage 同构（活先例）。decode 方向不读 text 输入。
register({
  id: "dctWatermark",
  cat: "stego",
  name: "DCT 盲水印",
  desc: "文本水印嵌入/提取（8×8 DCT 中频 QIM 量化）。嵌入方向输出带水印 PNG，提取方向输出文本，须同强度/通道。",
  params: [
    { key: "strength", label: "强度(量化步长 Q)", type: "number", default: 24, placeholder: "16-40，越大越鲁棒越显痕；提取须与嵌入一致" },
    { key: "channel", label: "嵌入通道", type: "select", default: "B", options: CHANNEL_OPTIONS },
    { key: "message", label: "水印文本", type: "text", default: "", placeholder: "嵌入方向要写进图片的文本" },
  ],
  encode: dctWatermarkEncodeOp,
  decode: dctWatermarkDecodeOp,
  acceptsBytes: true,
});

export default { dct8x8, idct8x8, qimEmbed, qimExtract, embedIntoImageData, decodeFromImageData };
