/*
 * codeImageLayout.js — 编码图 A0 槽位布局 sidecar 的按需加载器（T774）。
 *
 * 资产：public/data/codeimage/codeImageLayout.bin（自定义二进制 CIL1）。
 *   来源研究件：资料/工程留存/v0.1.14-预研/codeimage_a0/codeImageLayout.json（1.58 MB）。
 *   生成器：资料/工程留存/T774/assets/build_layout_asset.mjs。
 *   布局只提供对照表槽位的稳定 bbox/行列/单元 id，不参与字形分类；
 *   打开编码图页时才动态加载，缺失/损坏时静默返回 null，不影响识图主流程。
 *
 * 格式（全部小端）：
 *   "CIL1" | uint32 headerBytes | uint32 imageCount | uint32 slotCount
 *   header JSON：{ version, generated, note, ids[], meta[[w,h,rows,cols,extracted,slots]] }
 *   slot 记录：每个 9 × uint16 = 18 字节
 *     slot, row, col, x0, y0, x1, y1, bestD, aspect
 *   cellId 不入盘，按 "<id>/r{row}c{col}" 还原（生成器已验证 14136/14136 一致）。
 */
export const LAYOUT_FORMAT = "CIL1";
export const LAYOUT_VERSION = 1;
// 资产 URL 带版本查询：Chromium 对「.bin + force-cache」会按下载处理返回 204/0B，
// 且会把空响应回填进 SW 缓存；带 query 可同时绕开浏览器 HTTP 缓存与旧 SW 缓存里的毒化条目。
export const LAYOUT_URL = new URL("../../public/data/codeimage/codeImageLayout.bin?v=1", import.meta.url);

const SLOT_FIELDS = Object.freeze(["slot", "row", "col", "x0", "y0", "x1", "y1", "bestD", "aspect"]);
const SLOT_BYTES = SLOT_FIELDS.length * 2;

function toBytes(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  return null;
}

/**
 * 纯函数：解码 CIL1 布局资产。成功返回与原始 JSON 同构的
 * { version, generated, note, images: { <id>: { w,h,rows,cols,extracted, slots:[...] } } }。
 * 格式不符抛错（调用方 loadCodeImageLayout 会吞掉并回退 null）。
 */
export function decodeLayoutAsset(input) {
  const bytes = toBytes(input);
  if (!bytes || bytes.length < 16) throw new Error("布局资产为空或过短");
  for (let i = 0; i < LAYOUT_FORMAT.length; i++) {
    if (bytes[i] !== LAYOUT_FORMAT.charCodeAt(i)) throw new Error("布局资产魔数不匹配");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const headerBytes = view.getUint32(4, true);
  const imageCount = view.getUint32(8, true);
  const slotCount = view.getUint32(12, true);
  const headerEnd = 16 + headerBytes;
  if (headerEnd > bytes.length) throw new Error("布局资产头越界");

  let header;
  try {
    header = JSON.parse(new TextDecoder("utf-8").decode(bytes.subarray(16, headerEnd)));
  } catch {
    throw new Error("布局资产头不是合法 JSON");
  }
  if (!header || header.format !== LAYOUT_FORMAT) throw new Error("布局资产 format 不匹配");
  if (Number(header.version) !== LAYOUT_VERSION) throw new Error("布局资产 version 不支持");
  if (!Array.isArray(header.ids) || header.ids.length !== imageCount) throw new Error("布局资产 ids 数量不符");
  if (!Array.isArray(header.meta) || header.meta.length !== imageCount) throw new Error("布局资产 meta 数量不符");
  if (headerEnd + slotCount * SLOT_BYTES !== bytes.length) throw new Error("布局资产记录长度不符");

  const images = {};
  let off = headerEnd;
  let seen = 0;
  for (let i = 0; i < imageCount; i++) {
    const id = String(header.ids[i]);
    const meta = Array.isArray(header.meta[i]) ? header.meta[i] : [];
    const n = Number(meta[5]);
    if (!Number.isInteger(n) || n < 0) throw new Error("布局资产槽位数量非法");
    const slots = new Array(n);
    for (let j = 0; j < n; j++) {
      const slot = view.getUint16(off, true); off += 2;
      const row = view.getUint16(off, true); off += 2;
      const col = view.getUint16(off, true); off += 2;
      const x0 = view.getUint16(off, true); off += 2;
      const y0 = view.getUint16(off, true); off += 2;
      const x1 = view.getUint16(off, true); off += 2;
      const y1 = view.getUint16(off, true); off += 2;
      const bestD = view.getUint16(off, true); off += 2;
      const aspect = view.getUint16(off, true); off += 2;
      slots[j] = {
        slot, row, col,
        cellId: id + "/r" + row + "c" + col,
        x0, y0, x1, y1, bestD, aspect,
      };
    }
    seen += n;
    images[id] = {
      w: meta[0], h: meta[1], rows: meta[2], cols: meta[3], extracted: meta[4],
      slots,
    };
  }
  if (seen !== slotCount) throw new Error("布局资产槽位总数不符");

  return {
    version: header.version,
    generated: header.generated,
    note: header.note,
    images,
  };
}

let _layoutPromise = null;

/**
 * 按需加载布局资产（单例 Promise）。任何网络/解析错误返回 null，不抛异常。
 * opts.layout 可直接注入已解析对象（测试/离线用）；opts.fetchImpl / opts.url 便于验证。
 */
export function loadCodeImageLayout(opts = {}) {
  if (opts.layout) return Promise.resolve(opts.layout);
  if (_layoutPromise) return _layoutPromise;
  const fetchImpl = opts.fetchImpl || (typeof fetch === "function" ? fetch : null);
  if (!fetchImpl) return Promise.resolve(null);
  const url = opts.url || LAYOUT_URL;
  _layoutPromise = Promise.resolve()
    // 不能 force-cache：Chromium 对 .bin + force-cache 会当下载处理，返回 204/0B。
    .then(() => fetchImpl(url, { cache: opts.cache || "default" }))
    .then((res) => (res && res.ok !== false && res.status !== 204 ? res.arrayBuffer() : null))
    .then((buf) => (buf ? decodeLayoutAsset(buf) : null))
    .catch(() => null);
  return _layoutPromise;
}

/** 查询某对照表槽位的布局记录；不存在返回 null。 */
export function layoutSlotFor(layout, imageId, slot) {
  const im = layout && layout.images ? layout.images[imageId] : null;
  if (!im || !Array.isArray(im.slots)) return null;
  for (const s of im.slots) {
    if (s.slot === slot) return s;
  }
  return null;
}

export default {
  decodeLayoutAsset,
  loadCodeImageLayout,
  layoutSlotFor,
  LAYOUT_FORMAT,
  LAYOUT_VERSION,
  LAYOUT_URL,
};
