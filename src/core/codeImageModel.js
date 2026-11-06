/*
 * codeImageModel.js — 编码图字形的低算力离线 k-NN 原型模型。
 *
 * 设计目标：
 *   · 纯函数、零 UI 依赖：位图解码、建模型、分类、权重解析都不碰 DOM。
 *   · 原型向量直接取 codeImageFingerprints.json 的槽位（16×16 位图 + 宽高比）。
 *   · 默认零权重 = 未校准；可选 public/models/codeimage.meta.json + codeimage.dat
 *     提供逐位权重、chartBias、slotBias。文件缺失/格式不符/校验失败都静默回退，
 *     绝不因权重问题让识别流程抛错。
 *   · 只输出「候选」，不把候选当确定文本；字符映射仍由调用方（UI 人工确认）提供。
 *
 * 外部权重格式（版本 1）：
 *   codeimage.meta.json:
 *     {
 *       "format": "henglie.codeimage.knn",
 *       "version": 1,
 *       "data": "codeimage.dat",
 *       "dtype": "f32-le",
 *       "layout": { "bitWeights": { "offset": 0, "count": 256 } },
 *       "checksum": { "algo": "fnv1a32", "value": "0x1234abcd" },
 *       "aspectWeight": 0.2,
 *       "chartBias": { "<imageId>": 0 },
 *       "slotBias": { "<imageId>": { "<slot>": 0 } }
 *     }
 *   codeimage.dat:
 *     256 × float32-le，第 i 个权重对应 16×16 位图第 i 位。
 *     bitWeights 会被归一化到均值 1，因此距离量纲仍约等于 0..256。
 *   chartBias / slotBias 单位与距离相同，正数表示更不相似，负数表示加成。
 */

export const MODEL_VERSION = 1;
export const WEIGHTS_FORMAT = "henglie.codeimage.knn";
export const WEIGHTS_VERSION = 1;
export const DEFAULT_TOPK = 3;
export const DEFAULT_ASPECT_WEIGHT = 0.2;

// 描述子版本：1 = 现有 16×16 二值 Hamming（回退基线）；2 = 在 v1 位图上做稳健化的投影/分块特征（A0）。
export const DESCRIPTOR_VERSION = 2;
export const DEFAULT_DESCRIPTOR = 1;

/*
 * 描述子 v2（A0）：不扩展指纹 schema，仍只用现有 256 bit 位图，但补：
 *   · smooth：3×3 中值/多数滤波后的 256 bit，抑制孤立翻转位（抗噪）；
 *   · row/col：16+16 投影直方图，对局部错位不敏感（抗缩放残差）；
 *   · zone：4×4 分块墨量密度，抓粗粒度字形结构；
 *   · z8：8×8 降采样占用率，介于位与分块之间。
 * 距离仍归一到约 0..256，便于复用 aspectPenalty 与外部 chartBias/slotBias。
 */
export const V2_WEIGHTS = Object.freeze({
  raw: 0.50,
  smooth: 0.25,
  rowcol: 0.15,
  zone: 0.10,
});

function hammingWords(a, b) {
  return popcount32(a[0] ^ b[0]) + popcount32(a[1] ^ b[1]) + popcount32(a[2] ^ b[2]) + popcount32(a[3] ^ b[3])
    + popcount32(a[4] ^ b[4]) + popcount32(a[5] ^ b[5]) + popcount32(a[6] ^ b[6]) + popcount32(a[7] ^ b[7]);
}

/** 3×3 多数滤波（中心双权重），抑制椒盐噪声；输入输出均为 8×32bit 位图。 */
function smoothWords(words) {
  const b = new Uint8Array(BITS);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const i = y * 16 + x;
      b[i] = (words[i >> 5] >>> (i & 31)) & 1;
    }
  }
  const out = new Uint32Array(WORDS);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      let s = b[y * 16 + x] * 2;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const yy = y + dy, xx = x + dx;
          if (yy < 0 || yy > 15 || xx < 0 || xx > 15) continue;
          s += b[yy * 16 + xx];
        }
      }
      if (s >= 6) out[(y * 16 + x) >> 5] |= (1 << ((y * 16 + x) & 31));
    }
  }
  return out;
}

/** 纯函数：从 256 bit 位图导出 v2 描述子（墨量归一化的投影/分块 + 平滑位图）。 */
export function describeBits(words) {
  const b = new Uint8Array(BITS);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const i = y * 16 + x;
      b[i] = (words[i >> 5] >>> (i & 31)) & 1;
    }
  }
  const row = new Float32Array(16);
  const col = new Float32Array(16);
  const zone = new Float32Array(16);
  const z8 = new Float32Array(64);
  let ink = 0;
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      if (!b[y * 16 + x]) continue;
      ink++;
      row[y]++; col[x]++;
      zone[(y >> 2) * 4 + (x >> 2)]++;
      z8[(y >> 1) * 8 + (x >> 1)]++;
    }
  }
  // 归一化为概率分布：对整体变粗/变细不敏感，只比较形状。
  const inv = ink > 0 ? 1 / ink : 0;
  for (let i = 0; i < 16; i++) { row[i] *= inv; col[i] *= inv; zone[i] *= inv; }
  for (let i = 0; i < 64; i++) z8[i] *= inv;
  return { row, col, zone, z8, smooth: smoothWords(words), ink: ink / BITS };
}

function l1(a, b) {
  let d = 0;
  for (let i = 0; i < a.length; i++) d += Math.abs(a[i] - b[i]);
  return d;
}

function descriptorDistanceV2(q, p, w) {
  const raw = hammingWords(q.words, p.words) / BITS;
  const sm = hammingWords(q.desc.smooth, p.desc.smooth) / BITS;
  // 概率分布 L1 最大为 2：row+col 合起 /4，其余 /2。
  const rc = (l1(q.desc.row, p.desc.row) + l1(q.desc.col, p.desc.col)) / 4;
  const zn = l1(q.desc.zone, p.desc.zone) / 2;
  const z8d = l1(q.desc.z8, p.desc.z8) / 2;
  const weighted = raw * w.raw + sm * w.smooth + rc * w.rowcol + zn * (w.zone * 0.5) + z8d * (w.zone * 0.5);
  return Math.max(0, Math.min(1, weighted)) * BITS;
}

const BITS = 256;
const WORDS = 8;

function popcount32(x) {
  x = x - ((x >>> 1) & 0x55555555);
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

function b64ToBytes(b64) {
  if (typeof b64 !== "string" || !b64) return null;
  try {
    if (typeof atob === "function") {
      const bin = atob(b64);
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    }
    if (typeof Buffer !== "undefined") {
      return new Uint8Array(Buffer.from(b64, "base64"));
    }
  } catch { /* 交给调用方回退 */ }
  return null;
}

function bytesToWords(bytes) {
  if (!bytes || bytes.length < WORDS * 4) return null;
  const words = new Uint32Array(WORDS);
  for (let i = 0; i < WORDS; i++) {
    const o = i * 4;
    words[i] = (bytes[o] | (bytes[o + 1] << 8) | (bytes[o + 2] << 16) | (bytes[o + 3] << 24)) >>> 0;
  }
  return words;
}

/** 接受 Uint32Array/普通数组/16×16 位数组/base64，统一成 8 个 32 位字；失败返回 null。 */
export function toBits(value) {
  if (value == null) return null;
  if (value instanceof Uint32Array) {
    if (value.length < WORDS) return null;
    return value.length === WORDS ? value : value.slice(0, WORDS);
  }
  if (value instanceof Uint8Array || value instanceof ArrayBuffer) {
    const bytes = value instanceof ArrayBuffer ? new Uint8Array(value) : value;
    return bytesToWords(bytes);
  }
  if (Array.isArray(value)) {
    if (value.length === WORDS) {
      const words = new Uint32Array(WORDS);
      for (let i = 0; i < WORDS; i++) words[i] = Number(value[i]) >>> 0;
      return words;
    }
    if (value.length === BITS) {
      const words = new Uint32Array(WORDS);
      for (let i = 0; i < BITS; i++) {
        if (value[i]) words[i >> 5] |= (1 << (i & 31));
      }
      return words;
    }
    return null;
  }
  if (typeof value === "string") return bytesToWords(b64ToBytes(value));
  return null;
}

function prototypeAspect(g) {
  const raw = Number(g && g.a);
  if (!(raw > 0)) return 1;
  // fingerprint 的 a 是宽高比 ×100（语料范围 8..1200）；也容忍已经归一化的小数。
  return raw > 3 ? raw / 100 : raw;
}

function normalizeBitWeights(raw) {
  if (!raw || raw.length !== BITS) return null;
  let sum = 0, n = 0;
  for (let i = 0; i < BITS; i++) {
    const v = Number(raw[i]);
    if (Number.isFinite(v) && v >= 0) { sum += v; n++; }
  }
  if (!n || !(sum > 0)) return null;
  const mean = sum / n;
  const out = new Float32Array(BITS);
  for (let i = 0; i < BITS; i++) {
    const v = Number(raw[i]);
    out[i] = Number.isFinite(v) && v >= 0 ? v / mean : 1;
  }
  return out;
}

function normalizeBias(raw) {
  const out = Object.create(null);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [id, value] of Object.entries(raw)) {
    if (typeof value === "number" && Number.isFinite(value)) {
      out[id] = value;
    } else if (Array.isArray(value)) {
      out[id] = value.map((v) => (Number.isFinite(Number(v)) ? Number(v) : 0));
    } else if (value && typeof value === "object") {
      const arr = Object.create(null);
      for (const [slot, v] of Object.entries(value)) {
        const n = Number(v);
        if (Number.isFinite(n)) arr[slot] = n;
      }
      out[id] = arr;
    }
  }
  return out;
}

/** 纯函数：从 fingerprint 槽位构建原型模型。weights 可为 parseExternalWeights 的结果或内部权重对象。 */
export function buildModel(fingerprints, opts = {}) {
  const source = fingerprints && typeof fingerprints === "object" && fingerprints.images &&
    typeof fingerprints.images === "object" && !Array.isArray(fingerprints.images)
    ? fingerprints.images
    : (fingerprints && typeof fingerprints === "object" ? fingerprints : {});

  const ext = opts.weights && opts.weights.ok === false
    ? null
    : (opts.weights && opts.weights.weights ? opts.weights.weights : opts.weights);

  const bitWeights = normalizeBitWeights(ext && ext.bitWeights);
  const aspectWeightRaw = ext && ext.aspectWeight != null ? Number(ext.aspectWeight) : NaN;
  const aspectWeight = Number.isFinite(aspectWeightRaw) && aspectWeightRaw >= 0
    ? aspectWeightRaw
    : DEFAULT_ASPECT_WEIGHT;
  const chartBias = normalizeBias(ext && ext.chartBias);
  const slotBias = normalizeBias(ext && ext.slotBias);

  const requested = Number(opts.descriptor);
  const descriptor = requested === 2 ? DESCRIPTOR_VERSION : DEFAULT_DESCRIPTOR;
  const v2Weights = Object.assign({}, V2_WEIGHTS, opts.v2Weights || {});

  const prototypes = [];
  const byImage = new Map();
  for (const [imageId, fp] of Object.entries(source)) {
    if (!fp || typeof fp !== "object") continue;
    const glyphs = Array.isArray(fp.glyphs) ? fp.glyphs : [];
    const list = [];
    for (let slot = 0; slot < glyphs.length; slot++) {
      const g = glyphs[slot];
      const words = toBits(g && g.b);
      if (!words) continue;
      const proto = {
        imageId,
        slot,
        words,
        aspect: prototypeAspect(g),
      };
      if (descriptor === 2) proto.desc = describeBits(words);
      prototypes.push(proto);
      list.push(proto);
    }
    if (list.length) byImage.set(imageId, list);
  }

  return {
    version: MODEL_VERSION,
    descriptor,
    v2Weights,
    prototypes,
    byImage,
    bitWeights,
    aspectWeight,
    chartBias,
    slotBias,
    meta: {
      source: bitWeights ? "external-weights" : "fingerprint-prototype",
      descriptor: descriptor === 2 ? "v2" : "v1",
      prototypeCount: prototypes.length,
      imageCount: byImage.size,
      aspectWeight,
      bitWeight: bitWeights ? "external" : "uniform",
      external: ext ? {
        version: ext.version,
        checksum: ext.checksum || null,
        chartBiasCount: Object.keys(chartBias).length,
        slotBiasCount: Object.keys(slotBias).length,
      } : null,
    },
  };
}

function weightedHamming(a, b, weights) {
  if (!weights) {
    return popcount32(a[0] ^ b[0]) + popcount32(a[1] ^ b[1]) + popcount32(a[2] ^ b[2]) + popcount32(a[3] ^ b[3])
      + popcount32(a[4] ^ b[4]) + popcount32(a[5] ^ b[5]) + popcount32(a[6] ^ b[6]) + popcount32(a[7] ^ b[7]);
  }
  let d = 0;
  for (let w = 0; w < WORDS; w++) {
    let x = (a[w] ^ b[w]) >>> 0;
    const base = w << 5;
    while (x) {
      const lsb = x & -x;
      const idx = 31 - Math.clz32(lsb >>> 0);
      d += weights[base + idx];
      x = (x ^ lsb) >>> 0;
    }
  }
  return d;
}

function aspectPenalty(qa, pa, aspectWeight) {
  if (!(qa > 0) || !(pa > 0) || !(aspectWeight > 0)) return 0;
  const ratio = qa > pa ? qa / pa : pa / qa;
  if (!(ratio > 1)) return 0;
  const normalized = Math.min(1, Math.log(ratio) / Math.LN2);
  return BITS * aspectWeight * normalized;
}

function biasFor(model, imageId, slot) {
  let bias = 0;
  const cb = model && model.chartBias ? model.chartBias[imageId] : 0;
  if (typeof cb === "number" && Number.isFinite(cb)) bias += cb;
  const sb = model && model.slotBias ? model.slotBias[imageId] : null;
  if (sb != null) {
    const v = Array.isArray(sb) ? sb[slot] : sb[slot];
    if (Number.isFinite(Number(v))) bias += Number(v);
  }
  return bias;
}

function compareHit(a, b) {
  return a.distance - b.distance || a.order - b.order;
}

/**
 * 低算力加权 k-NN：返回最多 topK 个 { imageId, slot, distance, score }。
 * opts.imageId 可把检索限制在单张对照表内（UI 候选字符用）。
 */
export function classifyGlyph(bits, aspect, model, topK = DEFAULT_TOPK, opts = {}) {
  if (!model || !Array.isArray(model.prototypes) || !model.prototypes.length) return [];
  const words = toBits(bits);
  if (!words) return [];
  const qa = Number(aspect);
  const qaSafe = Number.isFinite(qa) && qa > 0 ? qa : 1;
  const k = Math.max(1, Math.min(64, Math.floor(Number(topK)) || DEFAULT_TOPK));

  const useV2 = (opts && opts.descriptor === 2)
    || ((opts == null || opts.descriptor == null) && model.descriptor === DESCRIPTOR_VERSION);
  const w = useV2 ? (model.v2Weights || V2_WEIGHTS) : null;
  const qDesc = useV2 ? describeBits(words) : null;
  const qSource = useV2 ? { words, desc: qDesc } : null;

  const filterId = opts && opts.imageId;
  let pool = model.prototypes;
  if (filterId != null && model.byImage && typeof model.byImage.get === "function") {
    pool = model.byImage.get(filterId) || [];
  }

  const hits = [];
  for (let i = 0; i < pool.length; i++) {
    const p = pool[i];
    let bitDist;
    if (useV2) {
      if (!p.desc) p.desc = describeBits(p.words);
      bitDist = descriptorDistanceV2(qSource, p, w);
    } else {
      bitDist = weightedHamming(words, p.words, model.bitWeights);
    }
    const penalty = aspectPenalty(qaSafe, p.aspect, model.aspectWeight);
    const distance = Math.max(0, bitDist + penalty - biasFor(model, p.imageId, p.slot));
    const score = Math.max(0, Math.min(1, 1 - distance / BITS));
    const hit = { imageId: p.imageId, slot: p.slot, distance, score, order: i };
    if (hits.length < k) {
      hits.push(hit);
      hits.sort(compareHit);
    } else if (compareHit(hit, hits[k - 1]) < 0) {
      hits[k - 1] = hit;
      hits.sort(compareHit);
    }
  }
  return hits.map((h) => ({
    imageId: h.imageId,
    slot: h.slot,
    distance: h.distance,
    score: h.score,
  }));
}

export function fnv1a32(bytes) {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function readF32Le(bytes, offset, count) {
  if (!bytes || offset < 0 || count <= 0) return null;
  const end = offset + count * 4;
  if (end > bytes.length) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = new Float32Array(count);
  for (let i = 0; i < count; i++) out[i] = view.getFloat32(offset + i * 4, true);
  return out;
}

function layoutEntry(meta, name) {
  if (!meta || !meta.layout) return null;
  if (Array.isArray(meta.layout)) {
    return meta.layout.find((x) => x && x.name === name) || null;
  }
  if (typeof meta.layout === "object") return meta.layout[name] || null;
  return null;
}

function hex32(v) {
  return String(v == null ? "" : v).toLowerCase().replace(/^0x/, "").padStart(8, "0");
}

/**
 * 纯函数：解析外部权重。校验 format/version/dtype/checksum/layout。
 * 成功返回 { ok:true, weights:{...} }；失败返回 { ok:false, error }，不抛异常。
 */
export function parseExternalWeights(meta, data) {
  const fail = (error) => ({ ok: false, error });
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return fail("meta 缺失或不是对象");
  if (meta.format !== WEIGHTS_FORMAT) return fail("format 不匹配");
  if (Number(meta.version) !== WEIGHTS_VERSION) return fail("version 不支持");

  let bytes;
  if (data instanceof Uint8Array) bytes = data;
  else if (data instanceof ArrayBuffer) bytes = new Uint8Array(data);
  else return fail("data 缺失");

  const dtype = String(meta.dtype || "f32-le").toLowerCase();
  if (dtype !== "f32-le" && dtype !== "float32-le") return fail("dtype 不支持");

  const cs = meta.checksum;
  if (!cs || typeof cs !== "object") return fail("缺少 checksum");
  const algo = String(cs.algo || "fnv1a32").toLowerCase().replace(/[-_]/g, "");
  if (algo !== "fnv1a32") return fail("checksum algo 不支持");
  const want = hex32(cs.value);
  const got = hex32(fnv1a32(bytes).toString(16));
  if (!cs.value || want !== got) return fail("checksum 不匹配");

  const entry = layoutEntry(meta, "bitWeights");
  let bitWeights = null;
  if (entry) {
    const offset = Number.isFinite(Number(entry.offset)) ? Number(entry.offset) : 0;
    const count = Number.isFinite(Number(entry.count)) ? Number(entry.count) : BITS;
    if (count !== BITS) return fail("bitWeights 数量必须为 256");
    bitWeights = readF32Le(bytes, offset, count);
  } else if (bytes.length >= BITS * 4) {
    bitWeights = readF32Le(bytes, 0, BITS);
  }
  if (!bitWeights) return fail("bitWeights 缺失或越界");

  const aspectRaw = meta.aspectWeight == null ? DEFAULT_ASPECT_WEIGHT : Number(meta.aspectWeight);
  const aspectWeight = Number.isFinite(aspectRaw) && aspectRaw >= 0 ? aspectRaw : DEFAULT_ASPECT_WEIGHT;

  return {
    ok: true,
    weights: {
      version: WEIGHTS_VERSION,
      bitWeights,
      aspectWeight,
      chartBias: normalizeBias(meta.chartBias),
      slotBias: normalizeBias(meta.slotBias),
      checksum: { algo: "fnv1a32", value: got },
      dataBytes: bytes.length,
    },
  };
}

function joinUrl(base, name) {
  const b = String(base || "");
  return b.endsWith("/") ? b + name : b + "/" + name;
}

/**
 * 可选外部权重加载器：优先 public/models/codeimage.meta.json + codeimage.dat。
 * 任何缺失/网络/解析/校验错误都返回 null，调用方静默回退 fingerprint 原型。
 */
export async function loadExternalWeights(opts = {}) {
  try {
    const baseUrl = opts.baseUrl || "public/models/";
    const fetchImpl = opts.fetchImpl || (typeof fetch === "function" ? fetch : null);
    if (!fetchImpl) return null;
    const metaUrl = opts.metaUrl || joinUrl(baseUrl, "codeimage.meta.json");
    const metaRes = await fetchImpl(metaUrl, { cache: opts.cache || "force-cache" });
    if (!metaRes || metaRes.ok === false) return null;
    const meta = await metaRes.json();
    if (!meta || meta.format !== WEIGHTS_FORMAT || Number(meta.version) !== WEIGHTS_VERSION) return null;
    const dataUrl = opts.dataUrl || joinUrl(baseUrl, meta.data || "codeimage.dat");
    const dataRes = await fetchImpl(dataUrl, { cache: opts.cache || "force-cache" });
    if (!dataRes || dataRes.ok === false) return null;
    const buf = await dataRes.arrayBuffer();
    const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    const parsed = parseExternalWeights(meta, bytes);
    return parsed.ok ? parsed.weights : null;
  } catch {
    return null;
  }
}

export default {
  buildModel,
  classifyGlyph,
  describeBits,
  parseExternalWeights,
  loadExternalWeights,
  toBits,
  fnv1a32,
  MODEL_VERSION,
  WEIGHTS_FORMAT,
  WEIGHTS_VERSION,
  DESCRIPTOR_VERSION,
  DEFAULT_DESCRIPTOR,
  DEFAULT_TOPK,
};
