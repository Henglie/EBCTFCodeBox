# tools/ — 构建与发行脚本

fork 后想复现构建、自己打包发行，看这里。日常开发用不到本目录；只有改了 op、改了资产、或要发版时才跑下面的脚本。

## 脚本一览

| 文件 | 干什么 | 什么时候跑 |
|---|---|---|
| `gen_sw_assets.mjs` | 扫描 git 跟踪的 `src/` + `public/`，生成根目录 `sw-assets.js`（PWA 预缓存清单 + ASSET_REV） | **改了 src/ 或 public/ 里的任何文件后**。不跑 = 老用户离线缓存对不上 |
| `gen_readme_ops.mjs` | 从 `src/main.js` 静态 import 闭包 + registry 重新生成 README 的「编解码全清单」op 总表 | **增删 op、改分类后**。不跑 = README 数字与实际不符 |
| `subset_fonts.py` | 把天珩全字库 TTF 切成按 Unicode 区块的 woff2 分片（`public/fonts/`） | 只在换字库时跑。需 Python 3 + `pip install fonttools brotli`，源 TTF 自备（官网 cheonhyeong.com） |
| `build_bkcrack.md` / `.sh` | bkcrack WASM 版的构建记录与脚本（上游 wasm 分支 + emscripten） | 只在升级 bkcrack 时看 / 跑 |
| `pack_release.mjs` | 发行包打包与校验（见下） | 发版时 |

## gen_sw_assets 的双处同步（坑）

懒加载资产（字体平面 / WASM / 语言包 / 对照图……）**不进预缓存**，靠 Service Worker 运行时回填。规则写在两处，**必须同步改**：

1. `tools/gen_sw_assets.mjs` 的 `EXCLUDE_RULES`（决定不进预缓存清单）
2. `sw.js` 的 `RUNTIME_CACHE_FIRST`（决定运行时网络→回填缓存→cache-first）

新增一个懒加载目录只改一边 = 该资产离线时静默 504，没有任何报错。改完必跑 `node 工具/rt_browser_ids.mjs`（⑤ 断网段验证回填）——该脚本在本地 `工具/` 目录，不在仓库里。

## pack_release 用法

```
node tools/pack_release.mjs stage   [--channel 吾爱破解|看雪论坛|L站|CSDN|恒烈的小窝]
node tools/pack_release.mjs verify  <已解包目录> [--channel 同上]
node tools/pack_release.mjs version
```

- `stage`：按白名单复制到**项目外**的 `_release_stage_<版本>/`，产 `_manifest.txt`。只出目录不做压缩，RAR 由作者手动打。`--channel` 从本地 `授权/成品授权/` 取该渠道已签 `license.bin` 放包根；不传则不带授权。
- `verify`：对已解包的发行包逐条比对白名单（缺失 / 多余都 fail），顺带跑六处版本号交叉校验 + 渠道校验（解 license payload 比对 source，防打错渠道）。
- `version`：只跑项目根的六处版本号交叉校验。
- 退出码：0 通过 / 1 校验失败 / 2 用法或环境错误。

⚠ **清单唯一事实源是本地 `PROGRESS.md` 的「发行包文件清单」表**（该文档不入库）。改本脚本的 `INCLUDE_FILES` / `INCLUDE_DIRS` / `DIR_EXCLUDE` / `CHANNELS`，必须同步改那张表，反之亦然——单改一边就是 v0.1.4 漏 tools/ 那次事故的翻版。

## exe/ — 运行时必需，勿删

`exe/cli/` + `exe/gui/` 是本地桥（根目录 `bridge.py`，`EXE_BASE` 指向这里）调用的白名单工具（bkcrack / steghide / foremost……）。**发行包里 tools/ 只带 exe/，其余脚本全部剔除**（`DIR_EXCLUDE`）。删了 exe/ = 十几个桥接 op 不可用。

## 其他前置

- `HenglieICO.png`（项目根）：全部 app-icon / logo 的图源，`pack_release` 白名单必带，已入 git。换图后用本地脚本重新生成派生图标。
- `授权/成品授权/`：五渠道签名授权，本地持有，绝不入 git / 入包（`--channel` 时按需取用）。
