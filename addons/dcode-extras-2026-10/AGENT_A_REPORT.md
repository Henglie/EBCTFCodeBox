# Agent A 报告 · dCode 扩展包 2026-10

日期：2026-10-30
仓库：`C:\Users\Administrator\Documents\我的项目源码\恒烈CTF编码工具箱项目`
工作范围：`addons\dcode-extras-2026-10\**` 与 `addons\official.json`；未改 `src/**`；未 git commit/push；未永久删除。仓库此前已有其他未提交改动，本 Agent 未触碰。

## 结果摘要

- 原有：97 op
- 新增：**27 op**
- 现在：**124 op**
- 新增文件：`ops/mathmore.js`（16）、`ops/textmore.js`（6）、`ops/numeralmore.js`（3）、`ops/ciphermore.js`（2）、`tests/selftest.mjs`
- 新增分类：`补全 · 古典密码`
- 自测：`SELFTEST PASS 103/103 assertions`
- 浏览器：`http://127.0.0.1:8899/#/plugins`，Playwright headless，`serviceWorkers:"block"`；点击官方插件「启用」后插件项显示 `124 op`，侧栏出现 6 个「补全 · …」分类（含新增「补全 · 古典密码」）
- 明确未完成 dCode 全站复刻；dCode `tools-list` 2026-10-30 抓取到 983 个唯一本地工具路径（982 相对 + `/cipher-identifier`），官方自述 over 900 tools

## 新增 op ID（27）

### 数学（16）

1. `dcode-extras-2026-10/math-happy` — 快乐数判定/区间列举（A007770）
2. `dcode-extras-2026-10/math-aliquot` — 真因子和 + 完全/过剩/不足数
3. `dcode-extras-2026-10/math-amicable` — 亲和数对（220,284 / 1184,1210）
4. `dcode-extras-2026-10/math-catalan` — Catalan 数（C10=16796）
5. `dcode-extras-2026-10/math-stirling2` — 第二类 Stirling 数（S(10,5)=42525）
6. `dcode-extras-2026-10/math-lucas` — Lucas 数（L10=123）
7. `dcode-extras-2026-10/math-josephus` — Josephus 幸存者（J(41,3)=31）
8. `dcode-extras-2026-10/math-egyptian` — 埃及分数贪心分解（4/13=1/4+1/18+1/468）
9. `dcode-extras-2026-10/math-goldbach` — Goldbach 分拆（100 有 6 组）
10. `dcode-extras-2026-10/math-twinprimes` — 孪生素数对
11. `dcode-extras-2026-10/math-persistence` — 加法/乘法数位持久性（39→3；277777788888899→11）
12. `dcode-extras-2026-10/math-pell` — Pell 方程最小解（D=61 → 1766319049/226153980）
13. `dcode-extras-2026-10/math-farey` — Farey 数列（F5 全列）
14. `dcode-extras-2026-10/math-thuemorse` — Thue–Morse 序列/前缀校验
15. `dcode-extras-2026-10/math-matrix` — 矩阵行列式/秩/逆（BigInt 有理数精确）
16. `dcode-extras-2026-10/math-tonelli` — 模平方根 Tonelli–Shanks（10 mod 13 → 6/7）

### 文本（6）

17. `dcode-extras-2026-10/txt-numwords-en` — 整数 ↔ 英文数词（123456789 全词）
18. `dcode-extras-2026-10/txt-casestyle` — camel/snake/kebab/constant 等 8 种命名风格
19. `dcode-extras-2026-10/txt-palindrome` — 回文/异形词/全字母句检测
20. `dcode-extras-2026-10/txt-wordwrap` — 按宽度换行（可选硬切超长词）
21. `dcode-extras-2026-10/txt-rovar` — Rövarspråket 编/解（hello ↔ hohelollolo）
22. `dcode-extras-2026-10/txt-ubbi` — Ubbi Dubbi 编/解（hello ↔ hubellubo）

### 记数（3）

23. `dcode-extras-2026-10/num-greek` — 希腊 Ionian 字母记数（2024=͵βκδ）
24. `dcode-extras-2026-10/num-hebrew` — 希伯来字母记数（5784=ה׳תשפ״ד；15=ט״ו）
25. `dcode-extras-2026-10/num-unicodedigits` — 30 种 Unicode 文字十进制数字（天城文/泰文/藏文/数学粗体等）

### 古典密码（2）

26. `dcode-extras-2026-10/cipher-myszkowski` — Myszkowski 换位（TOMATO + ATTACKATDAWN → AATDTKTNACAW）
27. `dcode-extras-2026-10/cipher-quagmire` — Quagmire I/II/III（单字母向量 A→G/S/B，整串往返）

注：Myszkowski 与 Quagmire 是公开经典算法，dCode `tools-list` 未单列这两项；收录原因是它们补主件古典密码空白且可给出确定性往返向量。

## 测试命令与结果

### 1. Node 自测（新增 op + index 注册）

```bash
node addons/dcode-extras-2026-10/tests/selftest.mjs
```

结果：

```text
SELFTEST PASS 103/103 assertions
```

覆盖：27 个新增 op 的已知向量/往返/异常断言；`index.setup` mock ctx 核对总注册数 124、分类 6、op id 无重复、中英文 i18n 消息存在。

### 2. Node 导入主注册表计数

```bash
node --input-type=module -e "await import('./src/core/registerAll.js'); const r=await import('./src/core/registry.js'); console.log('OPS', r.OPS.length);"
```

结果：`OPS 878`（与改造前一致，未改 `src/**`）。

### 3. 浏览器验收

- 服务：`http://127.0.0.1:8899/`（本地已有静态服务，HTTP 200）
- Playwright：Python sync API，Chromium 156 headless，`service_workers="block"`
- 步骤：打开 `#/plugins` → 在「官方插件」区找到 `dCode 扩展包 · 2026-10 · 124 op` → 点击「启用」
- 结果：
  - 插件项文本：`dCode 扩展包 · 2026-10 · 124 op` / `v2026.10.1` / `124 op · 0 解码贡献 · 0 AI 源`
  - 侧栏出现「补全 · 数学工具」「补全 · 古典密码」等 6 个分类
  - 未出现页面错误/启动失败
- 说明：`src/ui/pluginPanel.js` 内的 `OFFICIAL_FALLBACK` 仍保留旧名称（属 `src/**`，本任务禁止修改）；正常路径读取更新后的 `addons/official.json`，因此 UI 显示新名称与 124 op。

## 重复审计（原有 97）

- 严格同算法 4 个：`num-dice`、`num-domino`（均被主件 `pipNumerals` 覆盖）、`math-basefactorial`（`factorialBase`）、`math-negabase`（`negabase`）。
- 部分重叠 9 个：`sym-pigpen`、`sym-braille-gs8`、`math-wordvalue`、`sym-hexagram`、`txt-acrostic`、`txt-diff`、`math-sydney`、`txt-count`、`txt-case`。
- 其余 84 个未找到主件直接对应项。
- 未删除任何旧 op（用户要求不永久删除；保留兼容既有插件用户）。逐项对照见 `COVERAGE.md`。

## 文件变更

- `addons/official.json` — 名称/描述/版本更新为 124 op；不再是“全量扩展包”。
- `addons/dcode-extras-2026-10/index.js` — 新 manifest 名称/描述/版本；导入 4 个新 ops 文件；新增古典密码分类；i18n 分类映射；注册 124 op。
- `addons/dcode-extras-2026-10/ops/mathmore.js` — 新增 16 个数学 op。
- `addons/dcode-extras-2026-10/ops/textmore.js` — 新增 6 个文本 op。
- `addons/dcode-extras-2026-10/ops/numeralmore.js` — 新增 3 个记数 op。
- `addons/dcode-extras-2026-10/ops/ciphermore.js` — 新增 2 个古典密码 op。
- `addons/dcode-extras-2026-10/tests/selftest.mjs` — 103 条断言。
- `addons/dcode-extras-2026-10/README.md` — 改写为准确名称、124 op、测试命令、与主件关系、缺口。
- `addons/dcode-extras-2026-10/COVERAGE.md` — 覆盖矩阵、重复审计、缺口与不适用项。
- `addons/dcode-extras-2026-10/AGENT_A_REPORT.md` — 本报告。

未改 `src/**`；未改 `addon_wroking/**`；未 git commit/push。

## 剩余缺口与为什么不是全站复刻

- dCode `tools-list` 当前 983 个唯一本地工具路径、官方自述 over 900 tools；本包 124 op，页面级约 12.6%，算法级更低。
- 未完成的高价值项：Cadenus/Tridigital/Gromark/Nicodemus/Quagmire IV 等冷门古典密码；KenKen/Futoshiki/Skyscrapers/Hidato/Nurikabe/Slitherlink 等谜题；Cyrillic/Armenian/Georgian/Glagolitic 记数；Bernoulli/Eulerian/多边形数/Ulam 螺旋/素数间隙；Readability/Soundex/Metaphone；图片/OCR/音频/条码/多语言词典/自动密码识别器。
- 不做的原因：变体定义不一致且缺权威向量（硬写会产假结果）、词典/游戏答案表/字体与图像符号表的授权与体积、OCR/音频需要模型或原生库、dCode 描述与部分码表版权边界、站点工具持续新增、每个 op 都要有测试带来的质量成本。
- 结论：本包是“124 op 的 dCode 风格扩展包”，不是全站复刻；后续应按 `COVERAGE.md` 的高价值批次继续，而不是宣称完成。


