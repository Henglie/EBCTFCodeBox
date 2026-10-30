/*
 * qrZxingWorker.js — 把 ZXing WASM 扫描放到独立 Worker。
 * qrscan.js 用 6s 硬超时 terminate，避免恶意/病态二维码把主线程拖死。
 */
import { zxingReadRgba } from "./qrZxing.js";

self.onmessage = async (event) => {
  const { id, rgba, width, height, options } = event.data || {};
  try {
    const hits = await zxingReadRgba(new Uint8ClampedArray(rgba), width, height, options || {});
    self.postMessage({ id, hits: hits || [] });
  } catch (e) {
    self.postMessage({ id, error: String((e && e.message) || e) });
  }
};
