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
| `ui_smoke.mjs` | 真实浏览器跨尺寸、控件、对比度及可选 PWA 验证 | 界面改动；参数与 Playwright 准备见 [开发指南](../CONTRIBUTING.md) |
| `motion_check.mjs` | 确定性验证弹簧、低帧率与动效偏好 | 修改动效内核或节奏配置后 |
| `io_mode_check.mjs` | 输入模式推导与全部字节消费端输入目标检查 | 修改注册表 / 输入区显示逻辑后 |
| `ui_followup.mjs` | 三引擎定向验证输入框、BOM 诊断清理及代码编辑器桌面 / 手机布局 | 输入与编辑器回归复验 |
| `custom_editor_check.mjs` | 自定义代码缩进/配对/注释/撤销/粘贴/多选、查找与IME按键、保存与测试分离、会话草稿、源码竞态、长文档行列与触屏布局 | 三引擎；含新旧行列算法微基准，不将微基准当作整机输入延迟；可用 `--screenshots-dir` 留图 |
| `workbench_check.mjs` | 可调三分区、窄屏、多字段、PCAP 文件输入、交换与报告；`--editor-only` 检查换行/粘贴/撤销 | 操作台与编辑器变更后；`--self-test` 检查纯 Node 夹具 |
| `corners_check.mjs` | 连续曲率几何与真实像素、下拉外壳、焦点和阴影；`--app-perf` 检查千卡页面 | 形状绘制变更后，分别检查 Chromium / Firefox / WebKit |
| `interaction_perf_check.mjs` | 实页切换、千卡滚动/悬停、OP 输入、快速换算的布局读取/圆角扫描和长任务；同时核位按钮复用与双十进制结果 | 同机同浏览器前后对照；`--verify` 验有界工作量，Chromium 可加 `--profile` 输出 CPU 热点；Firefox/WebKit 不把缺失 Long Tasks API 当零长任务证据 |
| `alignment_check.mjs` | 字符集/四种视图、编辑框间距、标题基线、代码编辑器与旧草稿迁移 | 工作台对齐变更后，三引擎分别验证明暗与 320–1440px |
| `surfaces_check.mjs` | 环境设置分组、短窗口边界、展开编辑器、非工作台圆角、菜单和报告对齐 | 三引擎真实页面；`--screenshots-dir` 留图，`--json` 输出几何证据；系统 select 弹出菜单仍由浏览器管理 |
| `special_pages_check.mjs` | 配方/Fork/Merge、图形分区、裁剪恢复、独立字段、比例持久化、大报告/文件下载、特殊草稿、中断及清空竞态 | 三引擎；`--audit-inputs` 额外逐页核全部普通无主输入工具，使用隔离上下文 |
| `draft_binary_check.mjs` | 文件草稿字节/类型/名称、空文件、共享引用与循环结构 | 无浏览器的存储协议检查；用户运行不依赖 Node |
| `worker_lifecycle_check.mjs` | 取消后的迟到错误、新线程归属和真实线程失败回报 | 无浏览器的客户端生命周期夹具 |
| `apple_profile_check.mjs` | 四角原始十进制参数、限幅公式与完整路径独立对拍 | 对照 PixelCut 公开 UIKit shape_1，不以镜像近似冒充逐角原值 |
| `first_paint_check.mjs` | 冷启动、延迟主模块、动态插入/显示、真实弹窗逐帧形状与正圆/胶囊豁免 | 三引擎；不等待固定稳定后再断言，不以隐藏整页规避首帧 |
| `expressive_check.mjs` | M3排版/对比度、稳定按压、展开反向、浮层中断、三档节奏、减少动效、结果有效性、IME及触屏 | 三引擎；`--capture before/after --screenshots-dir <已有目录>` 获取同视口明暗截图 |
| `drafts_check.mjs` | 切页/刷新草稿、文件字节、多字段、图像恢复、跨标签清空与完整重置 | 草稿持久化、清空和启动路由修改后，使用隔离浏览器上下文 |
| `feedback_check.mjs` | 工作台运行/错误/取消/恢复、只读键盘语义、密码框尾端动作和 44px 触屏工具 | 本地静态服务器；支持 `--browser`、`--channel`、`--screenshots-dir`，Playwright 仅开发依赖 |
| `sm2_attack_check.mjs` / `sm2_attack_reference.py` | SM2 nonce 误用攻击独立对拍与异常样本 | Node + Windows `py -3.11` + 开发依赖 `gmssl==3.2.2`；运行时无需 Python |
| `sm_attack_check.mjs` | SM3 长度扩展/HMAC、SM4 攻击与一键尝试差分回归 | Node OpenSSL 需提供 SM3、SM4 ECB/CBC/CTR/OFB/GCM |
| `sm_attack_ui_check.mjs` | 9 个国密攻击 op 的真实执行、科普、文件产物与别名导航 | 本地服务器 + Playwright；前端测试将可选原生桥设为不可用 |

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
