/*
 * core/magic/byteStatCnn.js — 字节统计编码识别 CNN 的纯 JS 前向推理
 *
 * 结构（输入：256 个 byte id + 18 维统计特征）：
 *   byte_id[256] → Embedding(257×48, padding_idx=0) → 转置 → x[48][256]
 *     ├─ Conv1d(48→64, k=3, pad=1) → GELU → AdaptiveMaxPool1d(1) → 64
 *     ├─ Conv1d(48→64, k=5, pad=2) → GELU → AdaptiveMaxPool1d(1) → 64
 *     └─ Conv1d(48→64, k=7, pad=3) → GELU → AdaptiveMaxPool1d(1) → 64   → 拼 192
 *   stats[18] → Linear(18→48) → GELU → LayerNorm(48, eps=1e-5)            → 48
 *   concat(240) → Linear(240→128) → GELU → Linear(128→11) → logits
 *
 * 全 Float32Array + 手写循环，零第三方依赖：
 * - GELU 用精确式 0.5·x·(1+erf(x/√2))，erf 用 Abramowitz-Stegun 7.1.26 数值近似（|误差|≤1.5e-7）
 * - AdaptiveMaxPool1d(1) = 沿时间轴取最大值（非平均）
 * - LayerNorm 用有偏方差（/N），eps=1e-5，weight/bias 取自 stats_net.2
 * - Embedding padding_idx=0 行全零（权重第 0 行接近全零，不丢行）
 *
 * 权重来自本地同源资源 public/models/bytestat.dat（f32 小端）+ bytestat.meta.json
 * （记录各张量 offset/shape）。加载失败/缺失一律静默返回 null，绝不抛错——
 * 调用方（magic.js）据此降级为纯规则打分。
 */
import { byteEncode, statisticalFeatures } from "./inputProfile.js";

/** 11 个分类标签（顺序与分类头一致，不可调换） */
export const LABELS = [
  "plain_text",
  "opaque_token",
  "base64",
  "hex",
  "url_encode",
  "unicode_escape",
  "html_entity",
  "base32",
  "base85",
  "binary",
  "jwt",
];

// 本文件位于 src/core/magic/，向上三级到项目根 → public/models/（本地同源）
const META_URL = new URL("../../../public/models/bytestat.meta.json", import.meta.url);
const BIN_URL = new URL("../../../public/models/bytestat.dat", import.meta.url);

/** 加载 Promise 缓存：并发调用共享同一次加载，避免重复 fetch */
let _weightsPromise = null;

/**
 * 读本地同源资源（相对 import.meta.url 的 URL）。
 * 浏览器/Worker 走 fetch；node 下 file:// fetch 不支持，回退 fs（中文路径用 fileURLToPath）。
 * 全部失败返回 null。
 */
async function readLocal(url) {
  if (typeof fetch === "function") {
    try {
      const res = await fetch(url);
      if (res && res.ok) {
        const ab = await res.arrayBuffer();
        if (ab && ab.byteLength > 0) return ab;
      }
    } catch {
      /* 回退 fs */
    }
  }
  if (typeof process !== "undefined" && process.versions && process.versions.node) {
    try {
      const { fileURLToPath } = await import("node:url");
      const { readFile } = await import("node:fs/promises");
      const buf = await readFile(fileURLToPath(url));
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    } catch {
      /* 回退 null */
    }
  }
  return null;
}

/**
 * 加载模型权重（async，带缓存）。返回权重对象或 null（静默降级）。
 * 权重对象各张量均为 Float32Array，按 meta 的 offset/shape 从 bin 切片而来。
 */
export async function loadByteStatWeights() {
  if (_weightsPromise) return _weightsPromise;
  _weightsPromise = (async () => {
    try {
      const [metaAb, binAb] = await Promise.all([readLocal(META_URL), readLocal(BIN_URL)]);
      if (!metaAb || !binAb) return null;
      const meta = JSON.parse(new TextDecoder().decode(metaAb));
      const tensors = (meta && meta.tensors) || {};
      const bin = binAb;
      const get = (name) => {
        const t = tensors[name];
        if (!t || typeof t.offset !== "number" || typeof t.count !== "number") return null;
        if (t.offset < 0 || t.offset + t.count * 4 > bin.byteLength) return null;
        return new Float32Array(bin, t.offset, t.count);
      };
      const convs = [0, 1, 2].map((i) => ({ w: get(`convs.${i}.weight`), b: get(`convs.${i}.bias`) }));
      const weights = {
        emb: get("embedding.weight"),
        convs,
        statsW: get("stats_net.0.weight"),
        statsB: get("stats_net.0.bias"),
        lnW: get("stats_net.2.weight"),
        lnB: get("stats_net.2.bias"),
        fc0W: get("classifier.0.weight"),
        fc0B: get("classifier.0.bias"),
        fc1W: get("classifier.3.weight"),
        fc1B: get("classifier.3.bias"),
      };
      // 关键张量缺失/尺寸不符 → 判加载失败（静默降级）
      if (!weights.emb || weights.emb.length !== 257 * 48) return null;
      if (!convs.every((c) => c.w && c.b && c.w.length % (48 * 64) === 0 && c.b.length === 64)) return null;
      if (!weights.statsW || weights.statsW.length !== 48 * 18 || !weights.statsB || weights.statsB.length !== 48) return null;
      if (!weights.lnW || weights.lnW.length !== 48 || !weights.lnB || weights.lnB.length !== 48) return null;
      if (!weights.fc0W || weights.fc0W.length !== 128 * 240 || !weights.fc0B || weights.fc0B.length !== 128) return null;
      if (!weights.fc1W || weights.fc1W.length !== 11 * 128 || !weights.fc1B || weights.fc1B.length !== 11) return null;
      return weights;
    } catch {
      return null;
    }
  })();
  return _weightsPromise;
}

/** 数值近似 erf（Abramowitz-Stegun 7.1.26，|误差| ≤ 1.5e-7） */
function erf(x) {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const poly = ((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592;
  return sign * (1 - poly * t * Math.exp(-ax * ax));
}

/** GELU 精确式 0.5·x·(1+erf(x/√2)) */
function gelu(x) {
  return 0.5 * x * (1 + erf(x / Math.SQRT2));
}

/**
 * 前向推理：byte ids + 18 维统计 → 11 个 logits。
 * @param {Int32Array} byteIds 定长 256（见 inputProfile.byteEncode）
 * @param {Float32Array} stats 18 维统计特征（见 inputProfile.statisticalFeatures）
 * @param {object} weights loadByteStatWeights() 的返回值
 * @returns {Float32Array} 11 个 logits
 */
export function byteStatForward(byteIds, stats, weights) {
  const L = 256;   // 时间窗
  const D = 48;    // embedding / conv 输入通道
  const C = 64;    // conv 输出通道
  const KS = [3, 5, 7];

  // ---- embedding → x[48][256]（x 列优先存时间轴，便于卷积按行取连续窗口）----
  const emb = weights.emb;
  const x = new Float32Array(D * L);
  for (let t = 0; t < L; t++) {
    const base = byteIds[t] * D;
    for (let i = 0; i < D; i++) x[i * L + t] = emb[base + i];
  }

  // ---- 三个并行卷积 → GELU → AdaptiveMaxPool1d(1) → 拼 192 ----
  const textRepr = new Float32Array(C * 3);
  for (let ci = 0; ci < 3; ci++) {
    const { w, b } = weights.convs[ci];
    const K = KS[ci];
    const pad = K >> 1;
    const conv = new Float32Array(C * L);
    // 初始化偏置
    for (let c = 0; c < C; c++) {
      const bias = b[c];
      const rowBase = c * L;
      for (let t = 0; t < L; t++) conv[rowBase + t] = bias;
    }
    // 卷积：对每个 (c, i, k) 把 w[c,i,k]·x[i][·] 平移 pad 叠加进输出行
    for (let c = 0; c < C; c++) {
      const wC = c * (D * K);
      const rowBase = c * L;
      for (let i = 0; i < D; i++) {
        const xRow = x.subarray(i * L, i * L + L);
        for (let k = 0; k < K; k++) {
          const wVal = w[wC + i * K + k];
          if (wVal === 0) continue;
          const off = k - pad;
          const tStart = off < 0 ? -off : 0;
          const tEnd = off > 0 ? L - off : L;
          for (let t = tStart; t < tEnd; t++) {
            conv[rowBase + t] += wVal * xRow[t + off];
          }
        }
      }
    }
    // GELU + 时间轴最大池化
    for (let c = 0; c < C; c++) {
      let m = -Infinity;
      const rowBase = c * L;
      for (let t = 0; t < L; t++) {
        const v = gelu(conv[rowBase + t]);
        if (v > m) m = v;
      }
      textRepr[ci * C + c] = m;
    }
  }

  // ---- 统计支路：Linear(18→48) → GELU → LayerNorm(48, eps=1e-5) ----
  const statsPre = new Float32Array(48);
  for (let j = 0; j < 48; j++) {
    let acc = weights.statsB[j];
    const wBase = j * 18;
    for (let s = 0; s < 18; s++) acc += weights.statsW[wBase + s] * stats[s];
    statsPre[j] = gelu(acc);
  }
  let mean = 0;
  let meanSq = 0;
  for (let j = 0; j < 48; j++) {
    const v = statsPre[j];
    mean += v;
    meanSq += v * v;
  }
  mean /= 48;
  const varB = meanSq / 48 - mean * mean;   // 有偏方差（/N）
  const invStd = 1 / Math.sqrt(varB + 1e-5);
  const statsNorm = new Float32Array(48);
  for (let j = 0; j < 48; j++) statsNorm[j] = (statsPre[j] - mean) * invStd * weights.lnW[j] + weights.lnB[j];

  // ---- 融合 240 = 192 + 48 ----
  const DIM = C * 3 + 48;
  const fused = new Float32Array(DIM);
  fused.set(textRepr, 0);
  fused.set(statsNorm, C * 3);

  // ---- 分类头：Linear(240→128) → GELU → Linear(128→11) ----
  const h = new Float32Array(128);
  for (let j = 0; j < 128; j++) {
    let acc = weights.fc0B[j];
    const wBase = j * DIM;
    for (let s = 0; s < DIM; s++) acc += weights.fc0W[wBase + s] * fused[s];
    h[j] = gelu(acc);
  }
  const logits = new Float32Array(11);
  for (let c = 0; c < 11; c++) {
    let acc = weights.fc1B[c];
    const wBase = c * 128;
    for (let j = 0; j < 128; j++) acc += weights.fc1W[wBase + j] * h[j];
    logits[c] = acc;
  }
  return logits;
}

/** softmax（数值稳定：减去最大值） */
function softmax(logits) {
  let max = -Infinity;
  for (let i = 0; i < logits.length; i++) if (logits[i] > max) max = logits[i];
  const e = new Array(logits.length);
  let sum = 0;
  for (let i = 0; i < logits.length; i++) {
    e[i] = Math.exp(logits[i] - max);
    sum += e[i];
  }
  for (let i = 0; i < logits.length; i++) e[i] /= sum;
  return e;
}

/**
 * 一键预测：内部先算 18 维统计特征，再 forward → softmax → top5。
 * @param {string} text 输入文本
 * @param {object} weights loadByteStatWeights() 的返回值（null 则返回 null）
 * @returns {{logits:Float32Array, probs:number[], top5:{label,probability}[], predicted:string, features:Float32Array}|null}
 *   logits 11 个原始得分；probs 归一化概率；top5 降序前 5；predicted 最高概率标签；
 *   features 18 维统计特征（可解释性展示用）。
 */
export function byteStatPredict(text, weights) {
  if (!weights) return null;
  const byteIds = byteEncode(text);
  const features = statisticalFeatures(text);
  const logits = byteStatForward(byteIds, features, weights);
  const probs = softmax(logits);
  const order = [];
  for (let i = 0; i < LABELS.length; i++) order.push(i);
  order.sort((a, b) => probs[b] - probs[a]);
  const top5 = order.slice(0, 5).map((i) => ({ label: LABELS[i], probability: probs[i] }));
  return { logits, probs, top5, predicted: top5[0].label, features };
}
