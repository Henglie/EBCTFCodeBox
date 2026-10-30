import { register } from "./registry.js";
import { decodeUtf8Lossless } from "./bytesIo.js";

export class KnnError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = "KnnError";
    this.code = code;
    this.details = details || null;
  }
}

export const METRICS = Object.freeze(["euclidean", "manhattan"]);
export const TIE_BREAKS = Object.freeze(["A", "B", "error"]);

const NUM_RE = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

const fail = (code, message, details) => {
  throw new KnnError(code, message, details);
};

const isNumericToken = (token) => {
  if (typeof token !== "string") return false;
  const s = token.trim();
  return s !== "" && NUM_RE.test(s);
};

const parseLabelToken = (token, row) => {
  const s = String(token == null ? "" : token).trim().toUpperCase();
  if (s === "A" || s === "A车") return 0;
  if (s === "B" || s === "B车") return 1;
  fail("E_LABEL", `第 ${row} 行标签不是 A/B：${JSON.stringify(token)}`, { row, token });
};

const splitCsvLine = (line, delimiter) => line.split(delimiter);

const splitCsvText = (text) => {
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const raw = body.split(/\r\n|\n|\r/);
  const lines = [];
  for (const line of raw) {
    if (line.trim() === "") continue;
    lines.push(line);
  }
  return lines;
};

const defaultFeatureColumns = (cellCount, hasLabel, labelColumn, idColumn) => {
  const cols = [];
  for (let i = 0; i < cellCount; i++) {
    if (hasLabel && i === labelColumn) continue;
    if (!hasLabel && i === idColumn) continue;
    cols.push(i);
  }
  return cols;
};

const detectHeader = (line, opts, delimiter) => {
  const cells = splitCsvLine(line, delimiter);
  if (opts.hasLabel && opts.labelColumn >= cells.length) {
    fail("E_CSV", `首行只有 ${cells.length} 列，标签列 ${opts.labelColumn} 不存在`);
  }
  if (opts.hasLabel) {
    const label = cells[opts.labelColumn].trim().toUpperCase();
    if (label === "A" || label === "A车" || label === "B" || label === "B车") return false;
  }
  const cols = opts.featureColumns
    || defaultFeatureColumns(cells.length, opts.hasLabel, opts.labelColumn, opts.idColumn);
  for (const c of cols) {
    if (c >= cells.length) return false;
    if (!isNumericToken(cells[c])) return true;
  }
  return false;
};

export function parseKnnCsv(text, options = {}) {
  if (typeof text !== "string") fail("E_PARAM", "parseKnnCsv 需要字符串形式的 CSV 内容");
  const opts = {
    hasHeader: options.hasHeader === undefined ? "auto" : options.hasHeader,
    hasLabel: options.hasLabel === undefined ? true : !!options.hasLabel,
    labelColumn: options.labelColumn === undefined ? 0 : Number(options.labelColumn),
    idColumn: options.idColumn === undefined ? 0 : Number(options.idColumn),
    featureColumns: options.featureColumns || null,
    delimiter: options.delimiter === undefined ? "," : String(options.delimiter)
  };
  if (!["auto", true, false].includes(opts.hasHeader)) {
    fail("E_PARAM", "hasHeader 只支持 true / false / \"auto\"");
  }
  if (!Number.isInteger(opts.labelColumn) || opts.labelColumn < 0) {
    fail("E_PARAM", "labelColumn 必须是非负整数");
  }
  if (!Number.isInteger(opts.idColumn) || opts.idColumn < 0) {
    fail("E_PARAM", "idColumn 必须是非负整数");
  }
  if (opts.featureColumns !== null) {
    if (!Array.isArray(opts.featureColumns) || opts.featureColumns.length === 0) {
      fail("E_PARAM", "featureColumns 必须是非空数组");
    }
    for (const c of opts.featureColumns) {
      if (!Number.isInteger(c) || c < 0) fail("E_PARAM", "featureColumns 只能包含非负整数");
    }
  }
  if (opts.delimiter.length !== 1) fail("E_PARAM", "delimiter 必须是单个字符");

  const lines = splitCsvText(text);
  if (lines.length === 0) fail("E_EMPTY", "CSV 为空");

  let header = null;
  let start = 0;
  let hasHeader = false;
  if (opts.hasHeader === true) {
    hasHeader = true;
  } else if (opts.hasHeader === "auto") {
    hasHeader = detectHeader(lines[0], opts, opts.delimiter);
  }
  if (hasHeader) {
    header = splitCsvLine(lines[0], opts.delimiter).map((s) => s.trim());
    start = 1;
  }
  if (start >= lines.length) fail("E_EMPTY", "CSV 只有表头，没有数据行");

  const firstCells = splitCsvLine(lines[start], opts.delimiter);
  const featureColumns = opts.featureColumns
    ? opts.featureColumns.slice()
    : defaultFeatureColumns(firstCells.length, opts.hasLabel, opts.labelColumn, opts.idColumn);
  if (featureColumns.length === 0) fail("E_CSV", "没有可用于特征的列");

  const expectedCells = firstCells.length;
  const rowCount = lines.length - start;
  const featureCount = featureColumns.length;
  if (rowCount <= 0) fail("E_EMPTY", "CSV 没有数据行");

  const labels = opts.hasLabel ? new Uint8Array(rowCount) : null;
  const features = new Float64Array(rowCount * featureCount);
  const ids = new Array(rowCount);
  const maxColumn = Math.max(
    ...featureColumns,
    opts.hasLabel ? opts.labelColumn : Math.max(opts.idColumn, 0)
  );

  for (let r = 0; r < rowCount; r++) {
    const lineNo = start + r + 1;
    const cells = splitCsvLine(lines[start + r], opts.delimiter);
    if (cells.length <= maxColumn) {
      fail("E_CSV", `第 ${lineNo} 行只有 ${cells.length} 列，需要至少 ${maxColumn + 1} 列`, { row: lineNo, cells: cells.length });
    }
    if (header && cells.length !== header.length) {
      fail("E_CSV", `第 ${lineNo} 行列数 ${cells.length} 与表头列数 ${header.length} 不一致`, { row: lineNo });
    }
    if (!header && cells.length !== expectedCells) {
      fail("E_CSV", `第 ${lineNo} 行列数 ${cells.length} 与首行 ${expectedCells} 不一致`, { row: lineNo });
    }
    if (opts.hasLabel) {
      labels[r] = parseLabelToken(cells[opts.labelColumn], lineNo);
    } else {
      ids[r] = cells[opts.idColumn] === undefined ? "" : cells[opts.idColumn].trim();
    }
    const base = r * featureCount;
    for (let j = 0; j < featureCount; j++) {
      const raw = cells[featureColumns[j]];
      if (!isNumericToken(raw)) {
        fail("E_CSV", `第 ${lineNo} 行第 ${featureColumns[j] + 1} 列不是数值：${JSON.stringify(raw)}`, { row: lineNo, column: featureColumns[j] + 1 });
      }
      features[base + j] = Number(raw);
    }
  }

  return {
    labels,
    features,
    ids: opts.hasLabel ? null : ids,
    rowCount,
    featureCount,
    featureColumns,
    hasLabel: opts.hasLabel,
    hasHeader: hasHeader ? true : false,
    header,
    delimiter: opts.delimiter
  };
}

const normalizeMetric = (metric) => {
  const m = String(metric == null ? "euclidean" : metric).toLowerCase();
  if (m !== "euclidean" && m !== "manhattan") {
    fail("E_METRIC", `不支持的 metric：${JSON.stringify(metric)}，只支持 euclidean / manhattan`);
  }
  return m;
};

const normalizeTieBreak = (tieBreak) => {
  const t = String(tieBreak == null ? "B" : tieBreak).toUpperCase();
  if (t !== "A" && t !== "B" && t !== "ERROR") {
    fail("E_TIEBREAK", `不支持的 tieBreak：${JSON.stringify(tieBreak)}，只支持 A / B / error`);
  }
  return t;
};

const coerceDataset = (input, name, needLabels) => {
  if (!input || typeof input !== "object") fail("E_PARAM", `${name} 必须是数据集对象`);
  let rows = input.rowCount;
  let dims = input.featureCount;
  let features = input.features;
  let labels = input.labels === undefined ? null : input.labels;

  if (Array.isArray(features) && features.length > 0 && Array.isArray(features[0])) {
    rows = features.length;
    dims = features[0].length;
    const flat = new Float64Array(rows * dims);
    for (let i = 0; i < rows; i++) {
      if (!Array.isArray(features[i]) || features[i].length !== dims) {
        fail("E_DIM", `${name} 第 ${i + 1} 行特征维度不一致`);
      }
      for (let j = 0; j < dims; j++) {
        const v = Number(features[i][j]);
        if (!Number.isFinite(v)) fail("E_CSV", `${name} 第 ${i + 1} 行第 ${j + 1} 个特征不是有限数值`);
        flat[i * dims + j] = v;
      }
    }
    features = flat;
  } else if (features instanceof Float64Array) {
    if (rows === undefined && Number.isInteger(dims) && dims > 0) rows = features.length / dims;
    if (dims === undefined && Number.isInteger(rows) && rows > 0) dims = features.length / rows;
    for (let i = 0; i < features.length; i++) {
      if (!Number.isFinite(features[i])) fail("E_CSV", `${name} 第 ${i + 1} 个特征不是有限数值`);
    }
  } else if (Array.isArray(features) || ArrayBuffer.isView(features)) {
    const arr = features;
    if (rows === undefined && Number.isInteger(dims) && dims > 0) rows = arr.length / dims;
    if (dims === undefined && Number.isInteger(rows) && rows > 0) dims = arr.length / rows;
    const flat = new Float64Array(arr.length);
    for (let i = 0; i < arr.length; i++) {
      const v = Number(arr[i]);
      if (!Number.isFinite(v)) fail("E_CSV", `${name} 第 ${i + 1} 个特征不是有限数值`);
      flat[i] = v;
    }
    features = flat;
  } else {
    fail("E_PARAM", `${name}.features 必须是行数组或扁平数值数组`);
  }

  if (!Number.isInteger(rows) || rows <= 0) fail("E_EMPTY", `${name} 没有数据行`);
  if (!Number.isInteger(dims) || dims <= 0) fail("E_DIM", `${name} 特征维度必须为正整数`);
  if (features.length !== rows * dims) {
    fail("E_DIM", `${name} 特征总数 ${features.length} 与 ${rows}×${dims} 不一致`);
  }
  if (needLabels) {
    if (labels === null || labels === undefined) fail("E_LABEL", `${name} 缺少 labels`);
    if (labels.length !== rows) {
      fail("E_LABEL", `${name} labels 数量 ${labels.length} 与行数 ${rows} 不一致`);
    }
    const out = new Uint8Array(rows);
    for (let i = 0; i < rows; i++) {
      const v = Number(labels[i]);
      if (v !== 0 && v !== 1) {
        fail("E_LABEL", `${name} 第 ${i + 1} 行标签必须是 0(A)/1(B)，收到 ${JSON.stringify(labels[i])}`);
      }
      out[i] = v;
    }
    labels = out;
  } else {
    labels = null;
  }
  return { rowCount: rows, featureCount: dims, features, labels };
};

const distanceOf = (a, aBase, b, bBase, dims, metric) => {
  let sum = 0;
  if (metric === "euclidean") {
    for (let j = 0; j < dims; j++) {
      const dx = a[aBase + j] - b[bBase + j];
      sum += dx * dx;
    }
  } else {
    for (let j = 0; j < dims; j++) sum += Math.abs(a[aBase + j] - b[bBase + j]);
  }
  return sum;
};

export function knnPredict(train, test, options = {}) {
  const started = Date.now();
  const k = options.k === undefined ? 1 : Number(options.k);
  const metric = normalizeMetric(options.metric);
  const tieBreak = normalizeTieBreak(options.tieBreak);
  if (!Number.isInteger(k) || k < 1) fail("E_K", `k 必须是正整数，收到 ${JSON.stringify(options.k)}`);

  const tr = coerceDataset(train, "train", true);
  const ts = coerceDataset(test, "test", false);
  if (tr.featureCount !== ts.featureCount) {
    fail("E_DIM", `训练集维度 ${tr.featureCount} 与测试集维度 ${ts.featureCount} 不一致`);
  }
  if (k > tr.rowCount) {
    fail("E_K", `k=${k} 大于训练集行数 ${tr.rowCount}`);
  }

  const n = tr.rowCount;
  const m = ts.rowCount;
  const dims = tr.featureCount;
  const F = tr.features;
  const L = tr.labels;
  const T = ts.features;
  const labels = new Uint8Array(m);
  const distances = new Float64Array(m);
  const isTie = new Uint8Array(m);
  const tieRows = [];
  const voteTieRows = [];
  const comparisons = n * m;

  for (let q = 0; q < m; q++) {
    const qBase = q * dims;
    if (k === 1) {
      let best = Infinity;
      let countA = 0;
      let countB = 0;
      if (metric === "euclidean") {
        if (dims === 4) {
          const x0 = T[qBase], x1 = T[qBase + 1], x2 = T[qBase + 2], x3 = T[qBase + 3];
          for (let i = 0; i < n; i++) {
            const p = i * 4;
            const dx0 = F[p] - x0, dx1 = F[p + 1] - x1, dx2 = F[p + 2] - x2, dx3 = F[p + 3] - x3;
            const d = dx0 * dx0 + dx1 * dx1 + dx2 * dx2 + dx3 * dx3;
            if (d < best) {
              best = d;
              countA = 0;
              countB = 0;
              if (L[i] === 0) countA = 1;
              else countB = 1;
            } else if (d === best) {
              if (L[i] === 0) countA++;
              else countB++;
            }
          }
        } else {
          for (let i = 0; i < n; i++) {
            const p = i * dims;
            let d = 0;
            for (let j = 0; j < dims; j++) {
              const dx = F[p + j] - T[qBase + j];
              d += dx * dx;
            }
            if (d < best) {
              best = d;
              countA = 0;
              countB = 0;
              if (L[i] === 0) countA = 1;
              else countB = 1;
            } else if (d === best) {
              if (L[i] === 0) countA++;
              else countB++;
            }
          }
        }
      } else if (dims === 4) {
        const x0 = T[qBase], x1 = T[qBase + 1], x2 = T[qBase + 2], x3 = T[qBase + 3];
        for (let i = 0; i < n; i++) {
          const p = i * 4;
          const d = Math.abs(F[p] - x0) + Math.abs(F[p + 1] - x1) + Math.abs(F[p + 2] - x2) + Math.abs(F[p + 3] - x3);
          if (d < best) {
            best = d;
            countA = 0;
            countB = 0;
            if (L[i] === 0) countA = 1;
            else countB = 1;
          } else if (d === best) {
            if (L[i] === 0) countA++;
            else countB++;
          }
        }
      } else {
        for (let i = 0; i < n; i++) {
          const p = i * dims;
          let d = 0;
          for (let j = 0; j < dims; j++) d += Math.abs(F[p + j] - T[qBase + j]);
          if (d < best) {
            best = d;
            countA = 0;
            countB = 0;
            if (L[i] === 0) countA = 1;
            else countB = 1;
          } else if (d === best) {
            if (L[i] === 0) countA++;
            else countB++;
          }
        }
      }
      let chosen;
      if (countA > countB) {
        chosen = 0;
      } else if (countB > countA) {
        chosen = 1;
      } else {
        isTie[q] = 1;
        if (tieBreak === "ERROR") {
          fail("E_TIE", `第 ${q + 1} 行最近邻距离平票：A=${countA} B=${countB}，tieBreak=error`, {
            row: q + 1, distance: best, countA, countB
          });
        }
        chosen = tieBreak === "B" ? 1 : 0;
      }
      if (countA > 0 && countB > 0) {
        const detail = {
          row: q + 1,
          distance: metric === "euclidean" ? Math.sqrt(best) : best,
          squaredDistance: metric === "euclidean" ? best : null,
          countA,
          countB,
          chosen,
          resolvedBy: countA === countB ? "tieBreak" : "majority",
          metric,
          k: 1
        };
        tieRows.push(detail);
        if (countA === countB) voteTieRows.push(detail);
      }
      labels[q] = chosen;
      distances[q] = metric === "euclidean" ? Math.sqrt(best) : best;
    } else {
      const bestD = new Float64Array(k).fill(Infinity);
      const bestL = new Uint8Array(k);
      const bestI = new Int32Array(k);
      let filled = 0;
      let worst = Infinity;
      let worstAt = 0;
      let worstIdx = -1;
      for (let i = 0; i < n; i++) {
        const d = distanceOf(F, i * dims, T, qBase, dims, metric);
        if (filled < k) {
          bestD[filled] = d;
          bestL[filled] = L[i];
          bestI[filled] = i;
          filled++;
          if (filled === k) {
            worst = -1;
            worstIdx = -1;
            for (let j = 0; j < k; j++) {
              if (bestD[j] > worst || (bestD[j] === worst && bestI[j] > worstIdx)) {
                worst = bestD[j];
                worstAt = j;
                worstIdx = bestI[j];
              }
            }
          }
        } else if (d < worst) {
          bestD[worstAt] = d;
          bestL[worstAt] = L[i];
          bestI[worstAt] = i;
          worst = -1;
          worstIdx = -1;
          for (let j = 0; j < k; j++) {
            if (bestD[j] > worst || (bestD[j] === worst && bestI[j] > worstIdx)) {
              worst = bestD[j];
              worstAt = j;
              worstIdx = bestI[j];
            }
          }
        }
      }
      let countB = 0;
      for (let j = 0; j < k; j++) countB += bestL[j];
      const countA = k - countB;
      let chosen;
      if (countB * 2 > k) {
        chosen = 1;
      } else if (countA * 2 > k) {
        chosen = 0;
      } else {
        isTie[q] = 1;
        if (tieBreak === "ERROR") {
          fail("E_TIE", `第 ${q + 1} 行 k=${k} 投票平票：A=${countA} B=${countB}，tieBreak=error`, {
            row: q + 1, countA, countB, k
          });
        }
        chosen = tieBreak === "B" ? 1 : 0;
        const detail = {
          row: q + 1,
          distance: metric === "euclidean" ? Math.sqrt(worst) : worst,
          squaredDistance: metric === "euclidean" ? worst : null,
          countA,
          countB,
          chosen,
          resolvedBy: "tieBreak",
          metric,
          k
        };
        tieRows.push(detail);
        voteTieRows.push(detail);
      }
      labels[q] = chosen;
      distances[q] = metric === "euclidean" ? Math.sqrt(worst) : worst;
    }
  }

  return {
    labels,
    distances,
    isTie,
    tieRows,
    voteTieRows,
    k,
    metric,
    tieBreak: tieBreak === "ERROR" ? "error" : tieBreak,
    stats: {
      trainRows: n,
      testRows: m,
      featureCount: dims,
      comparisons,
      elapsedMs: Date.now() - started
    }
  };
}

const csvTextOf = (value) => String(value == null ? "" : value).replace(/^\uFEFF/, "");

const csvBytesToText = (bytes) => {
  const lossless = decodeUtf8Lossless(bytes);
  if (lossless.ok) return lossless.text;
  try {
    return new TextDecoder("gb18030").decode(bytes);
  } catch {
    return new TextDecoder("gbk").decode(bytes);
  }
};

const labelName = (v) => (v === 0 ? "A" : "B");

/**
 * op 主入口：训练集 CSV 走参数 trainCsv，待检测 CSV 走主输入框
 * （拖入文件时用 rawBytes 真字节，自动 UTF-8 → GB18030/GBK 回退）。
 */
function runKnnClassify(text, p) {
  const started = Date.now();
  try {
    const params = p || {};
    const trainText = csvTextOf(params.trainCsv);
    if (!trainText.trim()) {
      return "✗ 训练集为空。请把训练集 CSV 全文粘贴到参数「训练集 CSV 全文」：\n" +
        "  首行表头，首列为 A/A车/B/B车 标签，其余列为数值特征。";
    }
    const raw = params.rawBytes;
    const testText = raw && raw.length
      ? csvBytesToText(raw instanceof Uint8Array ? raw : new Uint8Array(raw))
      : csvTextOf(text);
    if (!testText.trim()) {
      return "✗ 待检测 CSV 为空。请把待检测 CSV 粘到输入框（首列序号，其余为数值特征），或直接拖入 CSV 文件。";
    }

    const train = parseKnnCsv(trainText, { hasHeader: "auto", hasLabel: true });
    const test = parseKnnCsv(testText, { hasHeader: "auto", hasLabel: false });
    const k = params.k === undefined || params.k === "" ? 1 : Number(params.k);
    const result = knnPredict(train, test, {
      k,
      metric: params.metric || "euclidean",
      tieBreak: params.tieBreak || "B",
    });

    let trainA = 0;
    for (let i = 0; i < train.labels.length; i++) if (train.labels[i] === 0) trainA++;
    const trainB = train.labels.length - trainA;
    let countA = 0;
    for (let i = 0; i < result.labels.length; i++) if (result.labels[i] === 0) countA++;
    const countB = result.labels.length - countA;

    const lines = [];
    lines.push("=== KNN 分类（A=0 / B=1）===");
    lines.push(`训练集: ${train.rowCount} 行 × ${train.featureCount} 特征${train.hasHeader ? "（含表头）" : ""}；A=${trainA} B=${trainB}`);
    lines.push(`待检测: ${test.rowCount} 行 × ${test.featureCount} 特征${test.hasHeader ? "（含表头）" : ""}`);
    lines.push(`参数: k=${result.k} metric=${result.metric} tieBreak=${result.tieBreak}`);
    lines.push("");
    lines.push("--- 预测明细（序号 / 预测 / 距离）---");
    lines.push("序号\t预测\t距离");
    for (let q = 0; q < result.labels.length; q++) {
      const id = test.ids && test.ids[q] !== "" ? test.ids[q] : String(q + 1);
      lines.push(`${id}\t${labelName(result.labels[q])}\t${result.distances[q].toFixed(6)}`);
    }
    lines.push("");
    lines.push("--- 统计 ---");
    lines.push(`预测数量: A=${countA} B=${countB}`);
    lines.push(`比较次数: ${result.stats.comparisons}`);
    lines.push(`耗时: 预测 ${result.stats.elapsedMs} ms，总计 ${Date.now() - started} ms`);
    if (result.tieRows.length) {
      lines.push(`距离并列行: ${result.tieRows.map((d) => "#" + d.row).join(", ")}`);
    }
    if (result.voteTieRows.length) {
      lines.push(`投票平票行: ${result.voteTieRows.map((d) => "#" + d.row).join(", ")}（按 tieBreak=${result.tieBreak} 处理）`);
    }

    const bitText = bitsToAscii(result.labels, { offset: 0, msbFirst: true, mapA: 0, mapB: 1 });
    const flag = bitText.match(/flag\{[^}]*\}/i);
    lines.push("");
    lines.push(`--- 预测位 → ASCII（MSB，8 bit/字符，${result.labels.length} bit，末尾 ${result.labels.length % 8} bit 忽略）---`);
    lines.push(bitText);
    if (flag) lines.push(`FLAG: ${flag[0]}`);

    return lines.join("\n");
  } catch (e) {
    if (e instanceof KnnError) return `✗ KNN 错误 [${e.code}]：${e.message}`;
    return "✗ KNN 运行失败：" + (e && e.message ? e.message : String(e));
  }
}

register({
  id: "knnClassify",
  cat: "analysis",
  name: "KNN 分类（新能源车 A/B）",
  desc: "K 近邻分类：训练集 CSV（首列 A/A车/B/B车 标签 + 数值特征）放参数，待检测 CSV（首列序号 + 数值特征）放输入框，逐行预测 A/B；支持 k、euclidean/manhattan、平票 tieBreak，输出每条预测、距离、统计，并把预测位按 MSB 解 ASCII（A=0/B=1）。拖入 GBK CSV 字节自动识别。",
  params: [
    {
      key: "trainCsv", label: "训练集 CSV 全文", type: "textarea", rows: 8, default: "",
      placeholder: "表头 + 数据行，首列标签 A/A车/B/B车，其余为数值特征，如：\n名称,防碰撞评分,电池容量评分,智能驾驶能力,智能座舱评分\nA车,27,89,50,15\nB车,93,89,0,56",
    },
    { key: "k", label: "K 值（最近邻个数）", type: "number", default: 1, min: 1, step: 1 },
    {
      key: "metric", label: "距离度量", type: "select", default: "euclidean",
      options: [
        { value: "euclidean", label: "欧氏距离（euclidean）" },
        { value: "manhattan", label: "曼哈顿距离（manhattan）" },
      ],
    },
    {
      key: "tieBreak", label: "平票处理", type: "select", default: "B",
      options: [
        { value: "B", label: "判为 B" },
        { value: "A", label: "判为 A" },
        { value: "error", label: "报错（error）" },
      ],
    },
  ],
  run: runKnnClassify,
  acceptsBytes: true,
});

export function bitsToAscii(bits, options = {}) {
  if (!bits || typeof bits.length !== "number") fail("E_PARAM", "bitsToAscii 需要 0/1 序列");
  const offset = options.offset === undefined ? 0 : Number(options.offset);
  const msbFirst = options.msbFirst === undefined ? true : !!options.msbFirst;
  const mapA = options.mapA === undefined ? 0 : Number(options.mapA);
  const mapB = options.mapB === undefined ? 1 : Number(options.mapB);
  if (!Number.isInteger(offset) || offset < 0 || offset > bits.length) {
    fail("E_PARAM", `offset 必须是 0..${bits.length} 的整数`);
  }
  if ((mapA !== 0 && mapA !== 1) || (mapB !== 0 && mapB !== 1)) {
    fail("E_PARAM", "mapA / mapB 只能是 0 或 1");
  }
  let out = "";
  let current = 0;
  let count = 0;
  for (let i = offset; i < bits.length; i++) {
    const raw = Number(bits[i]);
    if (raw !== 0 && raw !== 1) {
      fail("E_BITS", `第 ${i + 1} 个 bit 不是 0/1：${JSON.stringify(bits[i])}`, { index: i });
    }
    const bit = raw === 0 ? mapA : mapB;
    if (msbFirst) current = (current << 1) | bit;
    else current |= bit << count;
    count++;
    if (count === 8) {
      out += String.fromCharCode(current);
      current = 0;
      count = 0;
    }
  }
  return out;
}
