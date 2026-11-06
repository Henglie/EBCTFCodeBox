# public/vendor/ocr/ — 中英文 OCR 随包资产（零外发）

本目录是 OCR op（`src/core/ocr.js`）在浏览器本地运行所需的全部资产。
**运行时只读本目录，绝不请求 CDN、绝不上传用户图片。** 缺文件时 op 明确报错，不静默假成功。

## 文件清单与体积

| 文件 | 体积 (B) | 来源 | 许可证 |
|---|---|---|---|
| `tesseract.esm.min.js` | 63,220 | tesseract.js 7.0.0 `dist/tesseract.esm.min.js` | Apache-2.0 |
| `worker.min.js` | 111,307 | tesseract.js 7.0.0 `dist/worker.min.js` | Apache-2.0（内含 MIT 组件，见下） |
| `tesseract-core-lstm.wasm.js` | 3,896,484 | tesseract.js-core 7.0.0（LSTM 版，内嵌 wasm，无 SIMD，兼容最广） | Apache-2.0 |
| `tesseract-core-simd-lstm.wasm.js` | 3,899,472 | tesseract.js-core 7.0.0（LSTM+SIMD 版，内嵌 wasm） | Apache-2.0 |
| `lang-data/eng.traineddata` | 2,952,873 | @tesseract.js-data/eng 1.0.0（`4.0.0_best_int` LSTM 模型，内容为 gzip） | MIT（npm 包）/ Apache-2.0（上游 tessdata_best） |
| `lang-data/chi_sim.traineddata` | 1,718,768 | @tesseract.js-data/chi_sim 1.0.0（`4.0.0_best_int` LSTM 模型，内容为 gzip） | MIT（npm 包）/ Apache-2.0（上游 tessdata_best） |
| `LICENSE-tesseract.js.txt` | 11,357 | tesseract.js `LICENSE.md` | Apache-2.0 |
| `LICENSE-tesseract.js-core.txt` | 11,358 | tesseract.js-core `LICENSE` | Apache-2.0 |
| `tesseract.min.js.LICENSE.txt` | 149 | tesseract.js 第三方许可声明 | — |
| `worker.min.js.LICENSE.txt` | 466 | tesseract.js 第三方许可声明 | — |

**合计（不含本说明）**：**12,642,124 B ≈ 12.06 MiB**（约 12.64 MB）。
其中引擎（api + worker + core×2）约 7.97 MB，语言数据（eng + chi_sim）约 4.67 MB。

## 第三方组件（随 `worker.min.js` / `tesseract.esm.min.js` 打包）

- regenerator-runtime — MIT（Facebook）
- buffer — MIT（Feross Aboukhadijeh）
- ieee754 — BSD-3-Clause（Feross Aboukhadijeh）
- zlib.js — MIT（imaya）

## 关键实现说明

- **语言数据不带 `.gz` 后缀**：文件内容仍是 gzip（首两字节 1F 8B），但命名为
  `eng.traineddata` / `chi_sim.traineddata`，并在 `createWorker` 传 `gzip: false`。
  原因：实测 Edge 会把 URL 以 `.gz` 结尾的响应判定为「下载」，`fetch` 只得到
  HTTP 204 空体，导致 tesseract 加载语言失败。改名后 fetch 正常 200；
  tesseract 按 gzip 魔数自动解压，无需依赖后缀。
- 两个 core 变体：优先 SIMD 版（`tesseract-core-simd-lstm.wasm.js`），
  `WebAssembly.validate` 检测不支持 SIMD 时回退标量版（`tesseract-core-lstm.wasm.js`）。
  两者都是单线程 emscripten 构建，**不需要 COOP/COEP**。
- LSTM-only 引擎（OEM=LSTM_ONLY）配 `4.0.0_best_int` 模型，二者口径一致。
  引擎会打印若干 `Warning: Parameter not found: ...`（LSTM-only 内核不含 legacy 参数），
  属引擎内部告警，不影响识别结果。
- 首次加载后语言数据由 tesseract.js 写入 IndexedDB 缓存，后续不再重复下载。
