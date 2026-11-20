# 恒烈 CTF 编码工具箱 · Linux.do 微应用版

版本：L0.1.15（平台 manifest 版本必须为 `0.1.15`，界面显示 `L0.1.15`）

这是基于主项目 `src/core` 算法内核构建的 Linux.do 微应用入口。它复用声明式算法注册表，重新实现了一套适合单 IIFE、无 Worker、无动态加载的移动优先界面。

## 当前范围

- 663 个本地算法，覆盖 15 个分类：Base、文本/传输、古典密码、花式/CTF、深奥语言、哈希/校验、进制/字符集、分析/爆破、数据/序列化、现代密码·分组/流/其他、中文/本土、文本隐写、密码攻击。
- 一键解码：Base64/Base32/Hex/URL/HTML 实体/Unicode 转义/摩斯/培根/ROT13/Atbash/凯撒/二进制/十进制/八进制，支持浅层递归。
- 独立算法工作台：参数、方向切换、文本输入输出、收藏、草稿、科普卡。
- 线性配方：预设、增删改序、逐步执行、步骤输出、配方保存。
- 我的：收藏、草稿、存储状态、主题/动效跟随、清空数据。
- 存储与剪贴板全部走 Linux.do SDK；无网络请求、无 Worker、无 `eval`/`new Function` 执行、无外部脚本/字体/图片。

首版只做文本通道。不注入 `rawBytes`，带 `acceptsBytes` 的算法按文本/UTF-8 兜底处理；不提供文件选择、图片/音频上传、文件产物下载、OCR、WASM 引擎、本机 EXE/Python 桥、插件、自定义实现和批量处理。

## 目录

```text
mapp/
  build/
    select.mjs      从 src/core 生成静态注册表与目录
    build.mjs       esbuild 打包 + 平台体积/禁用项检查 + 生成 app.zip
    zip.mjs         确定性 ZIP 写入
    dev-server.mjs  本地预览服务器
    smoke.mjs       UI 冒烟
    exec-test.mjs   算法与一键解码对拍
    state-test.mjs  收藏/草稿/参数/主题持久化
    prod-smoke.mjs  生产包真实 SDK 路径测试
  public/
    index.html      平台正文片段（无脚本/内联样式/事件属性）
    strings.json    平台文案对象
  src/
    app.js          单 IIFE 入口
    generated/      select.mjs 生成，勿手改
    platform/       SDK、主题、存储、剪贴板适配
    core/           执行器、一键解码、搜索
    ui/             应用壳、视图、组件、图标
    styles/app.css  单份样式
    shims/          平台不适用模块的替身（联网随机源）
  manifest.json     平台清单模板
```

## 构建

需要 Node.js 20+。

```sh
npm install
npm run select     # 重新生成 src/generated（改了 src/core 或筛选规则后运行）
npm run dev        # 构建开发包并启动 http://127.0.0.1:5173/
npm run smoke      # 开发包 UI 冒烟（需要本机 Edge 或 Chrome）
npm run build      # 生产包：dist/web + dist/package/app.zip
```

有真实应用 ID 后：

```powershell
$env:MINI_APP_ID="平台分配的 UUIDv7"
$env:MINI_APP_VERSION="0.1.15"
npm run build
```

本版最终构建使用真实应用 ID `01a1bbdc-7132-771a-b04b-2081191c8b5d`。没有设置 `MINI_APP_ID` 时会使用占位 UUIDv7 `00000000-0000-7000-8000-000000000000`，构建输出会标记 `placeholderId: true`；占位 ID 不能用于沙箱或提审。

平台 manifest 的 `version` 只接受 `x.y.z` 三段数字，所以包内写 `0.1.15`；`L0.1.15` 只用于界面、文档和发布说明。

### 官方打包器复核

可用 linux-do 官方 `sdk/pack.mjs` 再打一次，确认平台契约：

```sh
npx -y bun <mapp-developer-guide>/sdk/pack.mjs dist/web/manifest.json dist/web dist/official
```

也可以设置 `MAPP_GUIDE` 后运行 `npm run pack:official`：官方产物写入 `dist/official/app.zip`，并复制为 `dist/package/app.zip`；自定义 ZIP 保留为 `dist/package/app-custom.zip`。上传 sandbox/提审时以官方 `pack` 产物为准。

本版已通过官方打包器校验。

## 算法筛选

`build/select.mjs` 从 `src/core/registerAll.js` 出发，递归扫描静态依赖，排除：

- Worker、`SharedArrayBuffer`、`WebAssembly`、`new Function`/`eval`、动态 `import()`、`fetch`、IndexedDB/原生 localStorage、canvas 图像管线。
- 不允许的分类：图像、音频、文件隐写、压缩/归档、取证/流量、文件格式、口令破解、非对称等。
- 本地桥/外部 EXE/Python、OCR、插件。

允许 15 个文本/密码分类；对 `randServer.js` 使用 shim，禁用联网随机源。筛选结果写入 `src/generated/registerSelected.js` 与 `src/generated/catalog.js`，报告写入 `build/selection-report.json`。

当前结果：运行时静态注册 859 个纯 JS op（含未暴露的非文本分类），UI 目录只暴露 663 个算法 / 15 分类 / 390 个静态入口模块；单份 `app.js` 约 5.8 MB（未压缩），官方 `app.zip` 约 2.3 MB。平台单文件上限 8 MiB，首屏内容上限约 12.3 MB，均有余量。品牌图标 `public/icons/app-icon-192.png` 作为 `assets` 声明，生产环境经 SDK 读为 Blob 显示，不走外部 URL。

## 平台适配

- 启动：渲染加载壳 → `sdk.ready` → 主题/存储 → 首屏 → `sdk.lifecycle.ready()`。
- 主题：跟随 `sdk.theme` 与 `onChange`，写入 CSS 变量；`reducedMotion` 进入 `data-reduce-motion`。
- 存储：`sdk.localStorage`，应用启动预读固定键，内存同步读写，约 420ms 防抖回写；单值 4 KiB、最多 12 个草稿键。
- 剪贴板：`sdk.clipboard`，超过 4 KiB 时只复制前 4 KiB 并提示。
- 无 SDK 时：开发构建提供浏览器模拟；生产构建要求从 Linux.do 微应用入口打开。

## 验证

- `node build/exec-test.mjs`：19/19，一键解码、MD5/SHA-256/NTLM 与算法往返。
- `node build/smoke.mjs`：9/9，首页/品牌图标/工作台/配方/我的/无 pageerror。
- `node build/state-test.mjs`：8/8，收藏、草稿、参数、主题持久化。
- `node build/prod-smoke.mjs`：生产包真实 SDK 路径通过。
- `node build/visual-check.mjs`：390×844 与 1440×900 无横向溢出，截图在 `资料/工程留存/L0.1.15/mapp-shots/`（本地资料，不入库）。
- 官方 `sdk/pack.mjs` 校验通过，5 个基础文件、无 asset/media、manifest 合法。

## 已知边界

- 663 个算法是兼容子集，不承诺与主站 978 个算法等价。
- 同步长算法会占用主线程；微应用没有 Worker，无法硬取消。界面只在批次之间让出。
- 文件/图片/音频/WASM/Worker/OCR/本机桥/插件/自定义实现/批量处理不在首版。
- 首版界面中文；不打包主站 20 语言与英文科普。
- 已取得真实应用 ID 并完成本地最终包（官方 `app.zip` 2,336,871 B / SHA256 `cfc0f73a...adb39a7`，低于 4096 KiB 上传上限）；2026-11-09 已上传并进入 Linux.do 正式版审核，审核结果未回；正式环境权限/存储/剪贴板/容器尚未验收。
