# dCode 扩展包 Beta · 2026-10 · 408 op

dCode.fr 的独立插件复刻包：不进入主工具箱 878 op 计数，默认不启用，启用后按插件分类注册。

- 插件 id：`dcode-extras-2026-10`
- 版本：`2026.10.3-beta.1`（apiVersion 1，Beta）
- 位置：`addons/dcode-extras-2026-10/`
- 当前 op：**408**
- dCode 工具入账：**988 / 988**（`coverage-all.json` 逐条可查）
- 覆盖状态：**490 implemented / 319 mapped / 179 blocked**
- 分类（6 个，固定前缀+图标）：dcode·数学、dcode·记数、dcode·文本、dcode·谜题、dcode·符号、dcode·古典

## 覆盖口径

- **implemented**：插件内有真实纯 JS 实现，并通过批内自测。
- **mapped**：主工具箱或既有插件已有精确对应 op，直接建立映射，不重复造轮子。
- **blocked**：图片/OCR/音频/外部数据库/站点导航/版权字体/未公开规则等，无法在不伪造的前提下离线实现；逐条原因见 `coverage-all.json` 与 `report-d*.md` / `report-e*.md`。
- 本轮由 D1–D4、E1–E4 八个批次补齐；全量台账与阻塞原因见 [COVERAGE.md](./COVERAGE.md)。

## 加载

1. 启动静态服务，打开 `#/plugins`。
2. 在“官方插件（默认不启用）”点“启用”。
3. 启用后显示 408 op；停用/卸载会精确回收本插件注册的 op、分类和词典。

## 自测

```bash
node addons/dcode-extras-2026-10/tests/selftest.mjs
node addons/dcode-extras-2026-10/tests/auto-d1.selftest.mjs
node addons/dcode-extras-2026-10/tests/auto-d2.selftest.mjs
node addons/dcode-extras-2026-10/tests/auto-d3.selftest.mjs
node addons/dcode-extras-2026-10/tests/auto-d4.selftest.mjs
node addons/dcode-extras-2026-10/tests/auto-e1.selftest.mjs
node addons/dcode-extras-2026-10/tests/auto-e2.selftest.mjs
node addons/dcode-extras-2026-10/tests/auto-e3.selftest.mjs
node addons/dcode-extras-2026-10/tests/auto-e4.selftest.mjs
```

## 边界

- 插件是 dCode 的工具层复刻，不是把 dCode 的图片/OCR/外部服务/版权字形打包进来。
- 179 个 blocked 工具不生成假 op、不返回猜测结果；后续补数据/模型后再升级。
- 新增 op 写入 `since`（动态批次 2026.10.3）与 `addedIn: v0.1.12-beta`；原 97 op 与主工具箱有少量同算法重叠，为兼容既有插件用户保留。
- Beta 已知限制：部分数学 op 有输入上限、随输入自动运行、未接 WASM；下版移除无意义限制并改为显式触发/大数 WASM。
