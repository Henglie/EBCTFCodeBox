/*
 * qrZxing.js — 图片读码适配层（ZXing-C++ / WebAssembly）。
 *
 * 定位：给「图片 → 二维码」这条路提供**工业级检测器**。既有自研链路（qrscanFind /
 * qrscanRefine / qrFindless）解决的是「定位符缺失 / 遮挡擦除 / 非整节距」这类
 * **规范内可证**的形态；本层补的是**真实拍摄图**的通用鲁棒性：任意位置、透视畸变、
 * 旋转、反色、多符号平铺、网点/半色调、低对比底图。两者互补，不是替换关系。
 *
 * 引擎：ZXing-C++ 经 emscripten 构建为 WebAssembly（npm 包 zxing-wasm）。
 * 上游：https://github.com/zxing-cpp/zxing-cpp（Apache-2.0）。
 * 资产：public/wasm/zxing/ 下 share.js + reader/index.js + reader/zxing_reader.wasm，
 *       与 public/wasm/{7zz,bkcrack} 同规格（懒加载、随包、可缺失降级）。
 *
 * 零外发：wasm 只从**本地相对路径**加载，绝不 CDN、绝不外发用户数据。
 * 缺失降级：资产不存在 / 加载失败 → 本层全部返回 null（不抛错、不白屏），
 *           调用方回退既有自研链路（同 bkcrack.js / sevenzip.js 的范式）。
 *
 * 契约：纯计算、零 UI 依赖、零 registry 依赖（不进 op 注册表，只被 qrscan /
 *       imageAnalysis 调用）。输入一律 **RGBA**（4 字节/像素），与 stegoPixels.decodePNG
 *       / canvas ImageData 同布局。
 */

// 与 src/core/ 相对的资产路径（浏览器按 http(s) URL 解析，Node 按 file:// 解析）。
const READER_URL = "../../public/wasm/zxing/reader/index.js";
const WASM_URL = "../../public/wasm/zxing/reader/zxing_reader.wasm";

// ============================================================
// 懒加载（单例 promise + 缺失降级）
// ============================================================
let _modPromise = null;   // 并发只加载一次
let _status = null;       // null=未试 / true=就绪 / false=缺失降级

/** 当前环境是否 http(s)（浏览器/本地服务）——决定 wasm 取字节的方式。 */
function isHttpEnv() {
  try {
    const p = new URL(import.meta.url).protocol;
    return p === "http:" || p === "https:";
  } catch { return false; }
}

/**
 * 懒加载 reader 模块并钉死 wasm 位置。
 * 不钉会踩一个真实陷阱：emscripten 产物在浏览器里把 wasm 解析成**相对页面**的
 * `zxing_reader.wasm`（不是相对模块），实际会 404 —— 必须显式给 locateFile。
 * @returns {Promise<object|null>} 模块或 null（缺失降级）
 */
async function loadReader() {
  if (_modPromise) return _modPromise;
  _modPromise = (async () => {
    try {
      const mod = await import(/* @vite-ignore */ READER_URL);
      if (!mod || typeof mod.readBarcodes !== "function") { _status = false; return null; }
      const overrides = {};
      if (isHttpEnv()) {
        const base = new URL("../../public/wasm/zxing/reader/", import.meta.url);
        overrides.locateFile = (name) => base.href + name;
      } else {
        // 非 http（Node/测试）：fetch 不支持 file://，直接读字节交给 wasmBinary。
        try {
          const fsMod = await import(/* @vite-ignore */ "node:fs");
          overrides.wasmBinary = fsMod.readFileSync(new URL(WASM_URL, import.meta.url));
        } catch { /* 读不到就交给引擎默认策略 */ }
      }
      if (typeof mod.prepareZXingModule === "function") mod.prepareZXingModule({ overrides });
      _status = true;
      return mod;
    } catch {
      _status = false; // 未随包 / 加载失败 → 降级
      return null;
    }
  })();
  return _modPromise;
}

/** 是否已确认可用（未试过返回 null）。供外部/测试探测。 */
export function qrZxingStatus() { return _status; }

// ============================================================
// 默认读码参数
// ============================================================
// 取向：**召回优先**。CTF 里「没扫出来」远贵于「多扫几个候选」，故：
//  tryHarder      穷举更多二值化与网格假设
//  tryRotate      任意旋转（含 90° 整数倍与任意角）
//  tryInvert      反色（白码黑底，CTF 常见）
//  tryDownscale   多尺度（大图小符号 / 小图大符号都覆盖）
//  maxNumberOfSymbols 多符号平铺（一张图里十几枚码时逐个报出）
export const QRZX_DEFAULT_OPTIONS = Object.freeze({
  formats: ["QRCode"],
  tryHarder: true,
  tryRotate: true,
  tryInvert: true,
  tryDownscale: true,
  maxNumberOfSymbols: 12,
});

/**
 * 读码范围预设。产品负责人 2026-09-26 指令「开放！」⇒ 本层不再只认二维码。
 * 约定：`formats: []`（空数组）交给引擎 = **全部可读格式**，不逐一列举（避免版本差异漏格式）。
 */
export const QRZX_FORMAT_PRESETS = Object.freeze({
  qr: ["QRCode"],
  qr_linear: ["QRCode", "Code128", "Code39", "Code93", "EAN-13", "EAN-8", "UPC-A", "UPC-E",
    "ITF", "Codabar", "DataBar", "DataBarExpanded"],
  all: [],
});

/** 读码范围参数 → ZXing 的 formats 数组；未知值一律退回「仅二维码」（不静默放开）。 */
export function qrZxingFormatsOf(key) {
  return (key && Object.prototype.hasOwnProperty.call(QRZX_FORMAT_PRESETS, key))
    ? QRZX_FORMAT_PRESETS[key]
    : QRZX_FORMAT_PRESETS.qr;
}

// ============================================================
// 结果规范化
// ============================================================
/**
 * 把引擎返回的 ReadResult[] 规范成纯数据数组。
 * 关键：**只保留 isValid === true**——开了 returnErrors 时引擎会连无效结果一起返回，
 * 不过滤就会把「没解出来」变成假成功（本项目的静默错误红线）。
 */
function normalizeResults(list) {
  const out = [];
  for (const r of list || []) {
    if (!r || r.isValid !== true) continue;
    if (typeof r.text !== "string" || r.text.length === 0) continue;
    out.push({
      text: r.text,
      format: r.format || "",
      ecLevel: r.ecLevel || "",
      version: r.version || "",
      isInverted: !!r.isInverted,
      isMirrored: !!r.isMirrored,
      orientation: typeof r.orientation === "number" ? r.orientation : 0,
      position: r.position || null,
      bytes: r.bytes instanceof Uint8Array ? r.bytes : null,
    });
  }
  return out;
}

// ============================================================
// 对外主入口
// ============================================================
/**
 * 对一张 **RGBA** 像素图读码。
 * @param {Uint8ClampedArray|Uint8Array} rgba 长度 = width*height*4
 * @param {number} width
 * @param {number} height
 * @param {object} [options] 覆盖 QRZX_DEFAULT_OPTIONS（formats 可传多格式做通用读码）
 * @returns {Promise<Array<{text,format,ecLevel,version,isInverted,isMirrored,orientation,position,bytes}>|null>}
 *          null = 引擎不可用（缺失降级）；[] = 引擎可用但未读到符号。
 */
export async function zxingReadRgba(rgba, width, height, options) {
  if (!rgba || !width || !height) return null;
  if (rgba.length < width * height * 4) return null;
  const mod = await loadReader();
  if (!mod) return null;
  const opts = Object.assign({}, QRZX_DEFAULT_OPTIONS, options || {});
  let raw;
  try {
    raw = await mod.readBarcodes({ data: rgba, width, height }, opts);
  } catch {
    return []; // 引擎异常按「没读到」处理，由调用方回退
  }
  return normalizeResults(raw);
}

export default { qrZxingStatus, zxingReadRgba, QRZX_DEFAULT_OPTIONS, QRZX_FORMAT_PRESETS, qrZxingFormatsOf };
