# THIRD-PARTY-NOTICE — 随包第三方组件署名、许可证与源码获取渠道

> 版本号与文件哈希均为本发行包内文件实测；许可文本为上游官方逐字副本（SHA256 附后）。

本项目（恒烈 CTF 编码工具箱）自有代码采用 Apache License 2.0（见根目录 `LICENSE`）。随包第三方组件分两级列示：
**A 组（GPL/LGPL，发布门禁级）**须随附许可证全文与对应源码获取渠道；**B 组（宽松许可）**须署名。

---

## A 组 · GPL / LGPL 组件（发布门禁）

### A1. steghide 0.5.1（GPL-2.0-or-later）— WASM 隐写引擎

- **用途**：steghide 隐写双向（JPEG DCT / WAV LSB，口令派生加密）。调用方 `src/core/steghide.js`（op id `steghide`）。
- **随包文件**：`public/wasm/steghide/steghide.js`（emscripten glue，SHA256 `ac94718a…29542`）、`public/wasm/steghide/steghide.wasm`（单线程引擎，SHA256 `9c3cec3f…d5c2a`）、`public/wasm/steghide/steghide.worker.js`（项目自研 Worker 壳，非上游代码）。
- **上游**：steghide 0.5.1，源码 tarball `https://downloads.sourceforge.net/project/steghide/steghide/0.5.1/steghide-0.5.1.tar.gz`（SHA256 `78069b7cfe9d1f5348ae43f918f06f91d783c2b3ff25af021e6a312cf541b47b`）；镜像仓库 `https://github.com/StegHigh/steghide`（其 `COPYING` 与 tarball 内 `COPYING` 逐字节一致）。
- **许可证**：GPL-2.0-or-later（上游 `COPYING` 全文＝`LICENSE-steghide.txt`，SHA256 `dc7091d200c57fd26a1f49c4db69bc42c71a16db174e0dbc4c153123d92657c4`）。
- **静态链入的 LGPL 依赖**（整体按最严的 GPL-2.0+ 口径分发即同时满足，逐件口径如下防下游写错版本）：
  - mhash 0.9.9.9 — **LGPL-2.0-or-later**（注意是 Library GPL v2，非 2.1；tarball SHA256 `3dcad09a…d13e`）；
  - libmcrypt 2.5.8 — LGPL-2.1-or-later（tarball SHA256 `e4eb6c07…373e`）；
  - jpeg-6b（IJG）— IJG 自由许可（分发须附含版权与免责声明的 README，摘录随开发档案留存）；
  - zlib 1.3.1 — zlib 许可（tarball SHA256 `9a93b2b7…df23`）。
- **本仓库如何取得**：以 emsdk 6.0.10 从上游 tarball 原样编译（上游源码零改动；仅生成 config 头与 C++ 可移植性 shim，不改算法语义）。构建脚本与全部上游 tarball、逐文件许可头存档于本项目开发档案（不入发行包，可经仓库渠道索取）。
- **如何自行获取对应源码**：`steghide.wasm` 为上游 0.5.1 原版源码 + 上述四依赖的静态构建，对应源码即上游 tarball（URL 与哈希见上）＋ 构建脚本。完整「对应源码」包（tarball + build_wasm.py + shim/patch 清单）可向本项目仓库索取；发行渠道见 README「开源协议」节。

### A2. Keystone 汇编引擎 0.9.2 线（GPL-2.0）— WASM 汇编引擎

- **用途**：快速换算「机器码&汇编 互转」面板汇编侧。调用方 `src/core/asmAssemble.js`（懒加载单例）。
- **随包文件**：`public/wasm/vendor/asm/asm-glue.js`（= npm `keystone-wasm@1.0.4` 的 `dist/index.mjs`，仅 sed 改 wasm 文件名两处，SHA256 `b1eed87d…74c6`）、`public/wasm/vendor/asm/asm.wasm`（SHA256 `cd19c262…b6ccc5`，与 `keystone-wasm@1.0.4` 包内 `dist/keystone.wasm` 逐字节一致，已实测）。
- **上游两级**：
  - 打包层：`keystone-wasm@1.0.4`（https://www.npmjs.com/package/keystone-wasm ，仓库 https://github.com/CzBiX/disasm-web `packages/keystone`，构建脚本 `build-lib.sh`：emsdk + CMake 从 keystone 源码编 wasm）；
  - 引擎层：Keystone Engine https://github.com/keystone-engine/keystone （1.0.4 发布对应 submodule commit `dc7932ef2b2c4a793836caec6ecab485005139d6`，2020-06-21；引擎发行线 0.9.2）。
- **许可证**：GPL-2.0（官方 `COPYING` 全文＝`LICENSE-keystone.txt`，SHA256 `ab15fd526bd8dd18a9e77ebc139656bf4d33e97fc7238cd11bf60e2b9b8666c6`）。Keystone 另提供：
  - `EXCEPTIONS-CLIENT`（FOSS License Exception，基于 Oracle FOSS 例外，允许列入清单的 GPL 不兼容 FOSS 许可链接 Keystone 库）——本项目主代码为 Apache-2.0，本就与 GPL-2.0 单向兼容路径无关，不依赖此例外；
  - `LICENSE-COM.TXT`（商业双许可，联系人 keystone.engine@gmail.com）。
  - 说明：网传的「llvm 链接例外」在官方仓库根未见独立文件，本项目未采信任何链接例外，以上游仓库原文为准。
- **如何自行获取对应源码**：`https://github.com/keystone-engine/keystone`（commit `dc7932e`）＋ `https://github.com/CzBiX/disasm-web` `packages/keystone/build-lib.sh`（emscripten 构建脚本）＋ npm `keystone-wasm@1.0.4` tarball（SHA-1 `951783444ae14333968108b07d033bbca06e8e9c`）。⚠ 该 wasm 是否能从 `dc7932e` 逐字节复现未验证（上游包无构建清单）——「源码渠道」承诺以此两级仓库 URL 为准，不承诺字节级复现。

### A3. OpenPGP.js v5.11.2（LGPL-3.0-or-later）— PGP/GPG 功能库

- **用途**：PGP 全家 8 op（生成/加密/解密/签名/验签/加密并签名/解密并验签/解析）。调用方 `src/core/pgp.js`（动态 import 懒加载）。
- **随包文件**：`src/vendor/openpgp.min.js`（553,086 B，SHA256 `8dd3e721276ce1fef258ee2963177067f2f3730c7bdba0e1b3015a51113cd4c8`）。头注逐字：`/*! OpenPGP.js v5.11.2 - 2024-06-19 - this is LGPL licensed code, see LICENSE/our website https://openpgpjs.org/ for more information. */`。
- **与官方 dist 的差异（已实测逐字节定位，共 2 处补丁）**：基线为 `https://cdn.jsdelivr.net/npm/openpgp@5.11.2/dist/openpgp.min.js`（SHA256 `b1dea0c61f3c0256a03934015571b808d365068a05d1a3c559d9389129552ed5`）；①偏移 18091 处 `new TextDecoder("utf-8")` → `new TextDecoder("utf-8",{ignoreBOM:!0})`（BOM 保真补丁，+15 B）；②尾部追加 153 B 的 ESM 化注释 + `export default openpgp;`。库本体逻辑零改动。**因存在改动，对应源码渠道须含本补丁说明**（补丁全文两行，随本通知即可复现：官方 dist + 上述两处差异）。
- **上游**：https://openpgpjs.org/ ，仓库 https://github.com/openpgpjs/openpgpjs （tag `v5.11.2`），npm `openpgp@5.11.2`（license 字段 `LGPL-3.0+`）。
- **许可证**：LGPL-3.0-or-later（v5.11.2 仓库 `LICENSE` 全文＝`LICENSE-openpgpjs.txt`，SHA256 `e3a994d82e644b03a792a930f574002658412f62407f5fee083f2555c5f23118`）。⚠ LGPL-3.0 第 4b/4d0 条要求随对象码同时提供 GPL-3.0 文本与最小对应源码——随包建议同时附 `LICENSE-GPL-3.0.txt`（gnu.org 官方文本，SHA256 `3972dc9744f6499f0f9b2dbf76696f2ae7ad8af9b23dde66d6af86c9dfb36986`）。
- **如何自行获取对应源码**：`https://github.com/openpgpjs/openpgpjs/tree/v5.11.2`（官方源码）＋本文件上段记录的 2 处补丁即完整对应源码；或 npm `openpgp@5.11.2` 包（含 src/）。

---

## B 组 · 宽松许可组件（署名义务）

| 组件 | 版本（实测） | 许可 | 随包位置 | 上游 |
|---|---|---|---|---|
| noble curves/hashes 最小闭包 | 随包实测 | MIT © 2022 Paul Miller | `src/core/lib/noble/`（含 LICENSE.txt） | https://github.com/paulmillr/noble-curves 、https://github.com/paulmillr/noble-hashes |
| bwip-js + BWIPP | 4.11.4 (2026-08-19) / BWIPP 2026-05-28（头注 `BWIPJS_VERSION` 实测） | 双 MIT（bwip-js © 2011-2026 Mark Warren；BWIPP © 2004-2024 Terry Burton） | `src/vendor/bwip-js.js`、`src/vendor/bwipp.js`（头注内嵌） | https://github.com/metafilter/bwip-js 、https://github.com/bwipp/postscriptbarcode |
| material-color-utilities | 0.4.0（package.json 实测） | Apache-2.0 | `public/vendor/material-color/`（含 LICENSE） | https://github.com/material-foundation/material-color-utilities |
| zxing-wasm | © 2023 Ze-Zheng Wu（随附 LICENSE 实测 MIT；上游 ZXing-C++ 为 Apache-2.0 但未随包） | MIT | `public/wasm/zxing/`（含 LICENSE） | https://github.com/Sec-ant/zxing-wasm （上游内核 https://github.com/zxing-cpp/zxing-cpp ，Apache-2.0） |
| CodeMirror 6 | 6.x bundle | MIT | `src/vendor/codemirror.bundle.js`（bundle 内无许可串——随包建议补本通知署名） | https://github.com/codemirror/dev （codemirror.net） |
| KaTeX | 0.16.11（katex.min.js `version:"0.16.11"` 实测） | MIT（字体 OFL） | `public/vendor/katex/` | https://github.com/KaTeX/KaTeX |
| 7-Zip（7zz WASM） | — | LGPL + unRAR restriction | `public/wasm/7zz.*` + `License.txt` + `unRarLicense.txt` | https://www.7-zip.org/ |
| bkcrack | 1.8.1（CHANGELOG 实测） | zlib/libpng（随包头注逐字：`Copyright (c) 2016-2026 Joachim Hotonnier`） | `public/wasm/bkcrack.*` + `bkcrack.license.txt` | https://github.com/kimci86/bkcrack |
| OutGuess 0.4 | commit 24810e14 | BSD-4-Clause + IJG | `public/wasm/outguess/`（NOTICE.txt + 两 LICENSE） | https://github.com/resurrecting-open-source-projects/outguess |
| Capstone（反汇编 WASM） | capstone-wasm@1.0.3 线 | BSD-3-Clause | `public/wasm/vendor/disasm/` | https://www.capstone-engine.org/ 、https://github.com/capstone-engine/capstone |
| Material Symbols | svg-400 | Apache-2.0 | `src/ui/icons.js` 内联 | https://fonts.google.com/icons |
| 天珩全字库 | V5.0.0（2025-09-25 编译） | 非商用（版权人沈天珩声明，详见 README 字体节） | `public/fonts/th/` | http://cheonhyeong.com/index.html |

---

*许可证全文见上文各「随包文件」路径；对应源码获取渠道以各条目所列上游 URL 与哈希为准。*
