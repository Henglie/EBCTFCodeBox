# 开发与贡献

项目使用原生 ES modules，前端无需构建。算法实现位于 `src/core/`，界面位于 `src/ui/` 与 `src/main.js`，翻译位于 `src/i18n/`。

## 分支与 PR

采用两个长期分支：

- `main`：稳定发布线，发布 tag 与 GitHub Release 从这里产生。
- `dev`：日常开发集成线，可提交可复现的阶段成果，不等于正式发布版。

日常工作流：

```text
feat/<主题> 或 fix/<问题> → PR → dev → 发布 PR → main → vX.Y.Z
```

单人维护时可直接向 `dev` 提交；多人协作时从最新 `dev` 建立短期功能分支，PR 的 base 选择 `dev`。交接提交应写清：已完成内容、验证命令、已知问题与下一步。

```bash
git fetch origin
git switch dev
git pull --ff-only origin dev
git switch -c feat/ui-refinement
```

首次创建本地 `dev` 后，由维护者执行一次 `git push -u origin dev`，其他协作者才能获取它。若历史开发提交已经累积在本地 `main`，先用 `dev` 保留完整历史，再由维护者核对稳定发布点并整理本地 `main`；无需改写远端历史。

发布 PR 将 `dev` 合入 `main`。推荐使用 **merge commit** 保留长期分支共同历史；功能 PR 可 squash。紧急修复从 `main` 建立 `fix/<问题>`，发布后同步合回 `dev`。

仓库维护者在 GitHub 开启 `main` 的 PR 保护和禁止强推。独立维护者可不强制他人审批，避免自己无法合并。分支保护属于 GitHub 配置，不会因创建本地分支而自动生效。

## 启动

Windows：

```powershell
py -3.11 通用点我启动.py
```

macOS / Linux：

```bash
python3 通用点我启动.py
```

也可使用项目根目录的原生启动器。浏览器验证优先用项目启动器，确保 `.mjs` 的 JavaScript MIME 与跨源隔离响应头正确；Windows 的通用 `http.server` 会受系统 MIME 表影响。

## 验证界面

开发环境安装 Playwright（仅用于验证，不是运行依赖）：

```bash
npm install --no-save --package-lock=false playwright
npx playwright install chromium
node tools/ui_smoke.mjs --base-url http://127.0.0.1:8180/
node tools/motion_check.mjs
```

已全局安装 Playwright 时，可用环境变量 `PLAYWRIGHT_MODULE` 指向其模块目录。其他参数：

- `--channel msedge`：使用已安装的 Edge。
- `--browser firefox` / `--browser webkit`：验证其他引擎，需要对应 Playwright 浏览器。
- `--screenshots-dir <已有目录>`：保存桌面、手机与主要页面截图。
- `--pwa`：验证真实 Service Worker 首次安装与离线重载。

界面脚本检查中英文键集合、离线语言包字节数、320–1440px 布局、48px 顶栏与更新文字对齐、批处理文字及滑轨明暗对比度、共享滑块、编码图浮层缩放、分类批量折叠、IME 输入、解码、搜索焦点与减少动效。开发期间新增文案以中英文为主，其余维护语言在发布前对齐。动效脚本验证弹簧低帧率稳定性、中途反向、节奏持久化及减少动效。

```bash
node tools/workbench_check.mjs --base-url http://127.0.0.1:8180/ --channel msedge
node tools/workbench_check.mjs --base-url http://127.0.0.1:8180/ --browser firefox --editor-only
node tools/corners_check.mjs --base-url http://127.0.0.1:8180/ --browser webkit --app-perf
node tools/alignment_check.mjs --base-url http://127.0.0.1:8180/ --channel msedge
node tools/surfaces_check.mjs --base-url http://127.0.0.1:8180/ --channel msedge
node tools/special_pages_check.mjs --base-url http://127.0.0.1:8180/ --channel msedge --audit-inputs
node tools/draft_binary_check.mjs
node tools/worker_lifecycle_check.mjs
node tools/apple_profile_check.mjs
node tools/expressive_check.mjs --base-url http://127.0.0.1:8180/ --channel msedge
node tools/first_paint_check.mjs --base-url http://127.0.0.1:8180/ --channel msedge
node tools/ui_followup.mjs --base-url http://127.0.0.1:8180/ --channel msedge
node tools/drafts_check.mjs --base-url http://127.0.0.1:8180/ --channel msedge
```

操作台检查包括桌面分栏、工作区自身宽度变化、手机堆叠、分隔条鼠标/键盘/RTL、真实转换与 PCAP 文件输入、多字段、参数式工具、自定义实现、独立页面隔离。`--editor-only` 检查真实键入、纯文本粘贴、换行、IME 事件及撤销重做；`--self-test` 无需浏览器，检查注册表与 PCAP 夹具；`--filter <正则>` 定向回归，`--json` 输出完整几何证据。圆角检查包含截图像素负控、描边/焦点/阴影、下拉外壳、动态控件与千卡页面性能，需分别跑三种引擎。

对齐检查覆盖四种视图、编辑框间距、标题与正文起边、代码编辑器及旧草稿迁移；全局表面检查覆盖环境分组、短窗口/旋转定位、展开编辑器的标题/正文/动作、非工作台页面与弹出菜单。系统 select 的选项弹出菜单仍由浏览器和操作系统绘制，测试只核闭合外壳及原生选择行为。

草稿检查覆盖切页、立即刷新、多字段、真实文件字节、图像结果、其他编辑页面、跨标签清空、IndexedDB 不可用时的文本回退、清空后的迟到文件与旧结果隔离，以及完整重置。仅使用隔离浏览器上下文。

运行资源变更后，重新生成 PWA 清单并确认第二次结果一致：

```bash
node tools/gen_sw_assets.mjs
node tools/gen_sw_assets.mjs
git diff --check
```

修改语言文件时，同步 `src/core/offlinePacks.js` 中对应文件的真实字节数及包总数，再生成清单。正式发行由维护者按 `tools/README.md` 的 stage / verify 流程完成。

## 界面约定

- 视觉与交互向 Material 3 Expressive 对齐；容器优先以色阶和留白分组，搜索框与普通按钮不画常驻描边，编辑区保留封闭边界。
- 非全圆矩形在三引擎由 `continuousCornersRuntime.js` 按 PixelCut 公开 UIKit shape_1 的四角原始参数绘制底色、描边、焦点与阴影；不得镜像一角代替四角、删减小数或另套超椭圆。`continuousCorners.js` 只作 ES module 门面，二者共用一个实现。入口在 head 通过经典脚本同步加载，DOM MutationObserver 检查点内完成新节点绘制，不等待 IO/下一 RAF，不用隐藏整页掩盖闪现。宿主不裁切浮层，CodeMirror 内容和媒体使用匹配裁剪。M3 正圆、胶囊与 range 圆弧保留原生几何；系统 select 弹出菜单和未支持复杂背景保留原生处理，`inspect()` 返回具体原因。该公开轮廓不声称与各代 Apple 私有实现逐像素一致。
- 普通独立算法使用 `op-workbench`；自适配模式在横屏分栏、竖屏堆叠，环境可切换为始终传统纵向。参数与数据默认各半，比例按操作／特殊页面分别持久化；支持左右键、Shift 大步进、Home/End 与 Enter/双击等分复位。科普卡必须作为操作台后置同级节点，分隔条不能伸入科普区域。
- 参数自适应两至三列，长编辑字段通栏；方向滑块保持自然宽度。输入输出工具内嵌编辑框右上角，输入视图在上、输出视图在下，报告为输出下方独立按钮。算法族从首个放不下的按钮开始进入下拉菜单，不能以横向滚动隐藏后续档位。
- 工作区草稿以页面/算法分别保存在本机 IndexedDB，文本写入同步日志以保护立即刷新；文件字节单独保留。环境的“一键清空输入输出”清除草稿及文件，保留算法参数、配方结构与环境设置；完整重置同时清除草稿数据库。草稿恢复不应重新触发重计算。
- 特殊页面复用 `specialWorkbench.js` 的分区与清理接口；配方中区放节点和参数，右侧放链头输入、最终输出和逐步结果，竖屏按输入→配方→输出排列。图鉴列表在窄屏有界滚动，选中后进入图像预览。
- 图像与批处理通过 `connectSpecialDraft` 保存原始文件、参数与人工状态，不保存派生 RGBA 缓冲。`draftBinary.js` 将文件转换为可移植字节记录；恢复时重建 File/Blob，缺失文件明确显示，批处理原“运行中”恢复为待执行。保存代次与任务归属须同时校验，清空后旧结果不得复活。
- 多字段工具保留各字段数值／文本契约；字段级工具操作不能清空其他字段。无需主输入的布局沿用注册契约，并由 fields、acceptsBytes 与有效自定义实现保守保护；不要根据名称或参数数量猜测。
- 数值滑块及分段滑轨共用 `src/ui/sharedControls.js` / `controls.css`，不再新增各页私有皮肤。保留原生范围输入与按钮的键盘操作、ARIA 状态和 RTL 支持。
- 环境面板提供快捷 / 标准 / 舒缓三档动效节奏，CSS 与弹簧共用同一偏好；装饰性运动服从减少动效设置。
- `expressive.css`集中阅读角色、tonal层级、状态层与浮层提升，不用渐变/玻璃替代层次。正圆/胶囊按压不改轮廓、不缩放文字，不恢复已取消的涟漪。
- `expressiveMotion.js`将小区块展开与浮层动效分开；反向从当前帧接续，关闭期间不可进入隐藏内容，退出完成事件决定移除。减动效即时完成，三档节奏只缩放动画时长，不缩放200ms等待指示阈值或计算时序。运行结果的stale身份与原始内容分别存储，动画不决定作业归属。
- 开发期间新文案优先中文与英文；法文、日文、韩文、俄文等维护语言的对齐在发布前执行，缺译按现有机制回退。
- 用户输入与密钥不外发。授权材料与本机内部资料不进入公开仓库；以 `.gitignore` 和发行白名单为准。
