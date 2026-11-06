/*
 * ocr.js — 中英文图片文字识别（OCR），对齐 CyberChef OpticalCharacterRecognition。
 *
 * 引擎：tesseract.js 7.0.0（Apache-2.0）+ tesseract.js-core 7.0.0，全部随包于
 *       public/vendor/ocr/。浏览器本地运行，零外发：worker/core/lang 三路径均显式指向
 *       本地，绝不回落到 tesseract.js 默认的 jsdelivr CDN。
 *
 * 只支持 英文(eng) + 简体中文(chi_sim)，语言可选 eng / chi_sim / eng+chi_sim。
 * 输入图片格式：png / jpg / bmp / pbm。
 *
 * 本模块只导出 handler 与纯函数，不 import registry、不自注册——注册与离线包登记由上层接线。
 * 建议注册对象见文件末 `OCR_OP`。
 *
 * 资源缺失：明确抛错（含缺失文件与路径），不静默返回空文本。
 */
import { imageInputBytes } from "./imageBytes.js";

/* ------------------------------------------------------------------ 常量 */

const VENDOR_BASE = new URL("../../public/vendor/ocr/", import.meta.url);

const ASSET = {
  api: "tesseract.esm.min.js",
  worker: "worker.min.js",
  coreSimd: "tesseract-core-simd-lstm.wasm.js",
  coreScalar: "tesseract-core-lstm.wasm.js",
  langDir: "lang-data/",
};

const MIME_BY_TYPE = {
  png: "image/png",
  jpg: "image/jpeg",
  bmp: "image/bmp",
  // 注意：tesseract.js loadImage 用 /data:image\/([a-zA-Z]*);base64,/ 匹配子类型，
  // 因此这里必须用「纯字母」子类型（真实取用只取逗号后 base64，MIME 仅用于匹配）。
  pbm: "image/pbm",
};

export const OCR_LANGS = ["eng", "chi_sim", "eng+chi_sim"];

export const OCR_LANG_LABELS = [
  { value: "eng", label: "英文（eng）" },
  { value: "chi_sim", label: "简体中文（chi_sim）" },
  { value: "eng+chi_sim", label: "英文 + 简体中文（eng+chi_sim）" },
];

const OEM_LSTM_ONLY = 1;
// tesseract.js 7 的浏览器分发只带 LSTM core + LSTM 模型，legacy OEM（0/2）没有实际能力。
// 对外只暴露 LSTM；旧存档里的 0/2 与 legacy 名称在读取时归一到 1（不报错、不改默认输出）。
const OEM_LEGACY_NAMES = new Set(["Tesseract only", "Tesseract/LSTM Combined"]);
function normalizeOem(v) {
  if (v == null || v === "") return OEM_LSTM_ONLY;
  if (v === OEM_LSTM_ONLY || v === "1") return OEM_LSTM_ONLY;
  if (v === 0 || v === "0" || v === 2 || v === "2") return OEM_LSTM_ONLY;
  const name = String(v);
  if (name === "LSTM only" || name === "DEFAULT") return OEM_LSTM_ONLY;
  if (OEM_LEGACY_NAMES.has(name)) return OEM_LSTM_ONLY;
  throw new Error(`OCR：不支持的 Engine Mode "${name}"`);
}

// 缺包/加载失败的统一可读出口：保留底层原因与失败 URL，另附离线包安装入口（T812 §9-2）。
const INSTALL_HINT = "离线包未安装：请到 扩展面板 → 离线包 → OCR（eng+chi_sim）安装后重试。";
function withInstallHint(msg) {
  const text = String(msg == null ? "" : msg);
  return text.includes("离线包未安装") ? text : `${text} ${INSTALL_HINT}`;
}

/* -------------------------------------------------------------- 工具函数 */

/** 嗅探支持的图片类型；不识别返回 null。仅认 png/jpg/bmp/pbm 魔数。 */
export function sniffImageType(bytes) {
  const b = bytes;
  if (!b || b.length < 3) return null;
  if (b.length >= 4 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "png";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpg";
  if (b[0] === 0x42 && b[1] === 0x4d) return "bmp";
  if (b[0] === 0x50 && (b[1] === 0x31 || b[1] === 0x34)) return "pbm"; // P1(ascii) / P4(binary)
  return null;
}

/** 检测本设备是否支持 WASM SIMD（用于择优选择 core；失败回退标量版）。 */
export function supportsSimd() {
  try {
    if (typeof WebAssembly === "undefined" || typeof WebAssembly.validate !== "function") return false;
    // wasm-feature-detect 的 SIMD 最小模块（i32x4 相关指令）。
    return WebAssembly.validate(new Uint8Array([
      0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0,
      10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11,
    ]));
  } catch { return false; }
}

/** Uint8Array → base64（分块，避免超长 String.fromCharCode.apply 爆栈）。 */
export function bytesToBase64(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  if (typeof btoa === "function") {
    let bin = "";
    const chunk = 0x8000;
    for (let i = 0; i < b.length; i += chunk) {
      bin += String.fromCharCode.apply(null, b.subarray(i, i + chunk));
    }
    return btoa(bin);
  }
  if (typeof Buffer !== "undefined") return Buffer.from(b).toString("base64");
  throw new Error("OCR：当前环境无 base64 编码能力（btoa/Buffer 均不可用）");
}

function normalizeLang(lang) {
  const l = typeof lang === "string" && lang.trim() ? lang.trim() : "eng";
  if (!OCR_LANGS.includes(l)) {
    throw new Error(`OCR：不支持的语言 "${lang}"（可选：${OCR_LANGS.join(" / ")}）`);
  }
  return l;
}

/** 统一取输入字节：rawBytes > Uint8Array/ArrayBuffer > dataURL/base64 文本。 */
export function inputToBytes(input, params) {
  const p = params || {};
  if (p.rawBytes && p.rawBytes.length) return new Uint8Array(p.rawBytes);
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (typeof ArrayBuffer !== "undefined" && ArrayBuffer.isView && ArrayBuffer.isView(input)) {
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  }
  return imageInputBytes(input, p, "OCR");
}

/* ---------------------------------------------------------- 引擎/worker */

let _apiPromise = null;

/** 懒加载本地 tesseract ESM 主体（同一 page 生命周期内只 import 一次）。 */
async function loadTesseractApi() {
  if (_apiPromise) return _apiPromise;
  const url = new URL(ASSET.api, VENDOR_BASE).href;
  _apiPromise = import(url).then((mod) => {
    const T = (mod && mod.default) ? mod.default : mod;
    if (!T || typeof T.createWorker !== "function") {
      throw new Error(`OCR 引擎无效：${ASSET.api} 未导出 createWorker`);
    }
    return T;
  }).catch((e) => {
    _apiPromise = null;
    throw new Error(withInstallHint(`OCR 引擎加载失败（${url}）：${e && e.message ? e.message : e}`));
  });
  return _apiPromise;
}

const _workers = new Map(); // lang -> { worker, logger }
const _preflighted = new Set(); // 已成功预检的资源 URL

/**
 * 资源预检：先查 Cache API——已安装离线包 / 已回填的运行时缓存命中即视为到位，不发任何请求；
 * 未命中且断网时不再 HEAD（否则每次新建 worker 都会产生 4 条 ERR_INTERNET_DISCONNECTED 噪声），
 * 交给引擎加载失败路径报错；只有在线且未缓存时才 HEAD 探测 4xx/5xx，不额外下载大文件。
 * 环境不支持 HEAD（如 file://）时跳过，交由引擎自身报错，不误伤。
 */
async function assertAsset(url, label) {
  if (_preflighted.has(url)) return;
  if (typeof caches !== "undefined" && typeof caches.match === "function") {
    try {
      const hit = await caches.match(url);
      if (hit) {
        _preflighted.add(url);
        return;
      }
    } catch {
      // Cache API 不可用时按「未缓存」继续，不影响后续引擎加载。
    }
  }
  if (typeof navigator !== "undefined" && navigator.onLine === false) return;
  if (typeof fetch !== "function") return;
  let res;
  try {
    res = await fetch(url, { method: "HEAD", cache: "no-store" });
  } catch { return; }
  if (res && res.ok === false) {
    throw new Error(withInstallHint(
      `OCR 资源缺失：${label} 返回 HTTP ${res.status}（${url}）。`
      + "请确认随包/离线包已包含 public/vendor/ocr/。",
    ));
  }
  _preflighted.add(url);
}

async function createWorkerFor(lang, onProgress, oem = OEM_LSTM_ONLY) {
  const T = await loadTesseractApi();
  const coreFile = supportsSimd() ? ASSET.coreSimd : ASSET.coreScalar;
  const workerUrl = new URL(ASSET.worker, VENDOR_BASE).href;
  const coreUrl = new URL(coreFile, VENDOR_BASE).href;
  const langDirUrl = new URL(ASSET.langDir, VENDOR_BASE).href;

  // 预检：worker / core / 每个语言的 traineddata。
  await assertAsset(workerUrl, ASSET.worker);
  await assertAsset(coreUrl, coreFile);
  const langs = lang.split("+");
  for (const l of langs) {
    await assertAsset(new URL(`${l}.traineddata`, new URL(ASSET.langDir, VENDOR_BASE)).href, `${l}.traineddata`);
  }

  const rec = { worker: null, logger: onProgress };
  let worker;
  try {
    worker = await T.createWorker(lang, oem, {
      workerPath: workerUrl,
      corePath: coreUrl,
      langPath: langDirUrl,
      // 语言数据以 gzip 内容存为 `.traineddata`（不带 .gz 后缀）：
      // 浏览器（实测 Edge）会把 URL 以 `.gz` 结尾的响应判定为「下载」，fetch 得到
      // HTTP 204 空体，导致 tesseract 加载语言失败。改扩展名后 fetch 正常返回 200；
      // tesseract 会按 gzip 魔数（1F 8B）自动解压，无需依赖后缀。
      gzip: false,
      logger: (m) => { if (typeof rec.logger === "function") rec.logger(m); },
      errorHandler: (e) => { rec.lastError = e; },
    });
  } catch (e) {
    throw new Error(withInstallHint(`OCR 引擎初始化失败（lang=${lang}, core=${coreFile}）：${e && e.message ? e.message : e}`));
  }
  rec.worker = worker;
  return rec;
}

async function getWorker(lang, onProgress, oem = OEM_LSTM_ONLY) {
  const key = lang + "|" + oem;
  let rec = _workers.get(key);
  if (!rec) {
    rec = await createWorkerFor(lang, onProgress, oem);
    _workers.set(key, rec);
  }
  rec.logger = onProgress;
  return rec;
}

/** 释放已缓存的 worker（不传 lang 释放全部）。测试/切换语言后可调用。 */
export async function disposeOcrWorker(lang) {
  const keys = lang ? [lang] : [..._workers.keys()];
  for (const k of keys) {
    const rec = _workers.get(k);
    _workers.delete(k);
    if (rec && rec.worker && typeof rec.worker.terminate === "function") {
      try { await rec.worker.terminate(); } catch { /* 忽略终止异常 */ }
    }
  }
}

/* ------------------------------------------------------------ 核心识别 */

/**
 * 识别图片字节，返回 { text, confidence, lang, type }。
 * confidence 为 tesseract 给出的 0..100 数值（非伪造）。
 */
export async function recognizeImage(bytes, opts = {}) {
  const b = inputToBytes(bytes, opts.params || {});
  const type = sniffImageType(b);
  if (!type) {
    throw new Error("OCR：不支持的图片类型（仅支持 png / jpg / bmp / pbm）");
  }
  const lang = normalizeLang(opts.lang);
  const oem = normalizeOem(opts.oem);
  const rec = await getWorker(lang, typeof opts.onProgress === "function" ? opts.onProgress : undefined, oem);
  const dataUrl = `data:${MIME_BY_TYPE[type]};base64,${bytesToBase64(b)}`;

  let result;
  try {
    result = await rec.worker.recognize(dataUrl);
  } catch (e) {
    throw new Error(`OCR 识别失败（lang=${lang}）：${e && e.message ? e.message : e}`);
  }
  const data = (result && result.data) || {};
  return {
    text: String(data.text == null ? "" : data.text),
    confidence: Number.isFinite(data.confidence) ? data.confidence : 0,
    lang,
    type,
  };
}

/**
 * op handler：图片（png/jpg/bmp/pbm）→ 文本（可选前置置信度行）。
 * 与 CyberChef 对齐：showConfidence 为真时输出 `Confidence: N%\n\n<text>`。
 *
 * @param {string|Uint8Array|ArrayBuffer} input 文本（dataURL/base64）或真实字节
 * @param {object} params { rawBytes?, lang?, showConfidence?, onProgress? }
 * @returns {Promise<string>}
 */
export async function run(input, params = {}) {
  const p = params || {};
  const bytes = inputToBytes(input, p);
  const onProgress = typeof p.onProgress === "function"
    ? p.onProgress
    : (typeof p.progress === "function" ? p.progress : undefined);
  const res = await recognizeImage(bytes, { lang: p.lang, oem: p.oem, onProgress });
  return p.showConfidence === false ? res.text : `Confidence: ${res.confidence}%\n\n${res.text}`;
}

/* --------------------------------------------------------- 注册建议对象 */

/**
 * 供上层接线用的 op 描述对象（本模块不调用 register）。
 * 接线示例：`import { OCR_OP } from "./core/ocr.js"; register(OCR_OP);`
 * 离线包：把 public/vendor/ocr/** 登记为一个独立 pack（建议 id "ocr"）。
 */
export const OCR_OP = {
  id: "ocr",
  cat: "image",
  name: "OCR 文字识别（英文 / 简体中文）",
  desc: "图片转文字，支持 png/jpg/bmp/pbm。识别语言可选 英文(eng) / 简体中文(chi_sim) / 中英混合(eng+chi_sim)。"
    + "引擎为 tesseract.js，worker/core/语言模型全部随包于 public/vendor/ocr/，浏览器本地运行，零外发、不上传图片；"
    + "首次使用需加载约 7.9MB 引擎 + 对应语言模型（eng≈2.95MB / chi_sim≈1.72MB），之后走 IndexedDB 缓存。"
    + "资源缺失时明确报错。默认输出首行为「Confidence: N%」。",
  acceptsBytes: true,
  params: [
    { key: "lang", label: "识别语言", type: "select", default: "eng", options: OCR_LANG_LABELS },
    { key: "showConfidence", label: "显示置信度", type: "bool", default: true },
    { key: "oem", label: "OCR Engine Mode", type: "select", default: "LSTM only", options: [
      { value: "LSTM only", label: "LSTM only" },
    ] },
  ],
  run,
};

export default { run, recognizeImage, disposeOcrWorker, sniffImageType, inputToBytes, bytesToBase64, supportsSimd, OCR_OP, OCR_LANGS, OCR_LANG_LABELS };
