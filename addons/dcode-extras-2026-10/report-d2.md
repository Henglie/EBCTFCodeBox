# Agent D2 报告 · dCode 数学/矩阵/函数/统计/几何/理化/图论/生物批

日期：2026-10-30
仓库：`C:\Users\Administrator\Documents\我的项目源码\恒烈CTF编码工具箱项目`
范围：`addons/dcode-extras-2026-10` 新增文件；未改 `index.js`、`official.json`、既有 ops/tests/README、`src/**`、library、stage；未 git commit/push；未永久删除。

## 1. 结果摘要

- 分配分区：12 个，共 **329 条分类-工具行**（原始清单含跨分类重复，对应 **303 个唯一 slug**）。
- 覆盖率台账：**329/329 全部入账**。
  - implemented：**276**
  - mapped：**39**
  - blocked：**14**
- 新增 op：**51 个**，id 全部 `d2-` 前缀，分类全部 `dcode-extras-2026-10/cat-math`。
- 自测：`AUTO-D2 SELFTEST PASS 640/640 assertions`。
- 模块/注册：`node --check` 通过；mock ctx 注册后 D2 op=51、总 op=354、id 重复=0（总数含并行批次 auto-d1/d3/d4）。

## 2. 分区覆盖表

| 分区 | 总数 | implemented | mapped | blocked |
|---|---:|---:|---:|---:|
| Arithmétique | 91 | 61 | 28 | 2 |
| Fonctions | 57 | 54 | 0 | 3 |
| Matrice | 38 | 33 | 0 | 5 |
| Calcul Formel | 32 | 30 | 1 | 1 |
| Combinatoire | 27 | 25 | 1 | 1 |
| Mathématiques (Autre/non classé) | 25 | 19 | 5 | 1 |
| Géométrie | 22 | 20 | 1 | 1 |
| Statistiques | 17 | 16 | 1 | 0 |
| Physique-Chimie | 10 | 9 | 1 | 0 |
| Séries | 5 | 4 | 1 | 0 |
| Théorie des Graphes | 3 | 3 | 0 | 0 |
| Biologie | 2 | 2 | 0 | 0 |
| **合计** | **329** | **276** | **39** | **14** |

## 3. 新增 op（51）

数学基础/数论：
`d2-bignum` `d2-baseconv` `d2-zeckendorf` `d2-complex` `d2-factor-tools` `d2-modular` `d2-quadratic` `d2-fraction-periodic` `d2-primes` `d2-numbertheory`

计算/组合/概率：
`d2-listcalc` `d2-magic-square` `d2-cryptarithm` `d2-holecalc` `d2-constants` `d2-solver24` `d2-permutations` `d2-combinations` `d2-probability` `d2-schedule` `d2-random`

矩阵/形式化：
`d2-matrix` `d2-eigen` `d2-poly` `d2-equation` `d2-boolean` `d2-expression` `d2-integral`

函数/几何/绘图：
`d2-function` `d2-interpolation` `d2-line` `d2-root` `d2-angle` `d2-triangle` `d2-pick` `d2-coords` `d2-koch` `d2-plot` `d2-graph`

统计/数值/理化/信号/生物：
`d2-numfmt` `d2-stats` `d2-percent` `d2-color` `d2-atomic` `d2-radioactivity` `d2-relativity` `d2-series` `d2-biology` `d2-dft` `d2-special` `d2-laplace`

## 4. Blocked 逐条（14）

| 分区 | 工具 | slug | 原因 |
|---|---|---|---|
| Arithmétique | Chiffre Multiplication Nombres Premiers | `chiffre-multiplication-nombres-premiers` | 古典密码变体，算法约定与权威向量未锁定，留给密码批 |
| Arithmétique | Conjecture de Pólya | `conjecture-polya` | 反例在 9 亿量级，纯 JS 全量验证不现实 |
| Fonctions | Développement Limité | `developpement-limite` | 一般函数展开需 CAS；本批只有多项式 Taylor（`d2-poly`） |
| Fonctions | Solveur d'Equation Différentielle | `solveur-equation-differentielle` | 符号微分方程求解需 CAS |
| Fonctions | Transformation Inverse de Laplace | `transformation-inverse-laplace` | 逆 Laplace 变换需 CAS |
| Matrice | Décomposition de Schur | `decomposition-schur-matrice` | Schur 分解需数值线性代数库/CAS |
| Matrice | Forme Normale d'Hermite | `hermite-matrice` | Hermite 标准形本批未实现 |
| Matrice | Matrice Conjuguée Complexe | `matrice-conjuguee-complexe` | 矩阵引擎为有理数，未支持复矩阵共轭 |
| Matrice | Réduction de Jordan | `jordan-matrice` | Jordan 标准形需 CAS |
| Matrice | Trigonalisation | `trigonalisation-matrice` | 三角化需 CAS |
| Calcul Formel | Solveur d'Equation Différentielle | `solveur-equation-differentielle` | 同上（同一 URL 跨分区重复） |
| Combinatoire | Système Réducteur de Tirage | `systeme-reducteur-tirage` | 保证覆盖的彩票/投注缩水系统需要组合覆盖设计，本批未实现 |
| Mathématiques (Autre) | Codage de NegaFibonacci | `codage-negafibonacci` | NegaFibonacci 编码约定未锁定，本批未实现 |
| Géométrie | Nom des Figures Géométriques | `figures-geometriques` | 图形名称图鉴类工具，无纯文本算法输入 |

## 5. mapped 说明

39 条 mapped 均指向已存在且可运行的 op，未重复造轮子；主要批次：

- 主件：`luhn`、`verhoeff`、`base36`、`base58`、`primeFactor`、`rsaModpow`、`gcd`、`rsa`、`colorInfo`。
- 既有插件：`math-kaprekar`、`math-basefactorial`、`math-negabase`、`num-bibi`、`math-goldbach`、`math-sydney`、`math-doublefactorial`、`math-factorial`、`math-knuth`、`math-vonmangoldt`、`math-v2adic`、`math-armstrong`、`math-harshad`、`math-carmichael`、`math-bell`、`math-primorial`、`math-derangement`、`math-rpn`、`math-fraction`、`math-digitsum`、`math-lookandsay`、`math-pascal`、`math-pythagorean`、`math-benford`、`num-tally`。

`expansion-cantor` 映射到既有阶乘进制（Cantor/阶乘数系同一表示），在台账 reason 中注明。

## 6. 测试证据

```text
node --check addons/dcode-extras-2026-10/ops/auto-d2.js
# 通过（无输出）

node addons/dcode-extras-2026-10/tests/auto-d2.selftest.mjs
# AUTO-D2 SELFTEST PASS 640/640 assertions
```

自测覆盖：

- 51 个 op 每个至少 1 条已知向量/往返/异常断言；关键 op 含多条。
- 台账：329 条、303 唯一 slug、状态计数 276/39/14、URL 与 slug 一致、无默认兜底未分诊、implemented 目标 op 存在。
- 已知向量示例：BigInt 加减幂/负进制、Zeckendorf、复数模/辐角、费马分解、CRT、DH、二次方程、1/7 循环节、幻方 3/4/6/10、SEND+MORE=MONEY、π 20 位、24 点、素数计数、φ/μ/τ/σ/λ、排列/组合秩、生日/二项概率、矩阵 det/inverse/rank/charpoly/LU/permanent、特征值/谱半径、多项式导数/积分/因式、方程/不等式、布尔化简、Simpson 积分、函数零点/周期/切线、插值、Pick、Koch、统计量、置信区间、颜色波长、Fe/Cu 电子排布、衰变、相对论、Fibonacci/连分数、网格 BFS/金字塔、密码子、生命游戏、SVG、DFT、erf/Γ、数值 Laplace。

## 7. 约定与限定（避免“能跑但结果口径不明”）

- Base37 约定为 `0-9 A-Z _`，`_` 代表第 36 位；Base58 使用 Bitcoin 字母表；Base26 为 `A=0..Z=25`。
- 矩阵引擎为 BigInt 有理数，最大 12×12；特征值为数值解（Durand–Kerner），对角化只对实特征值互异的小矩阵给出；Jordan/Schur/三角化/Hermite/复矩阵共轭未实现。
- 积分与函数分析为数值方法；周期/单调/定义域/渐近线为采样结论，输出中明确标注“数值/非符号证明”。
- `d2-atomic` 电子排布按 Aufbau + 常见例外校正，未覆盖全部镧系/锕系细节；元素符号编码按最长匹配，化学式存在歧义时以最长符号为准。
- `d2-laplace` 只做数值前向积分，逆变换 blocked。
- 所有搜索/列举/输出均有上限，超限显式报错；无外部 CAS、无网络请求、无伪造输出。
- `d2-constants` 的 `search` 只在 π 前 5000 位内检索（台账 reason 已注明）。

## 8. 与其他批次/既有测试的关系

- 未修改 `index.js`；其 `AUTO_BATCHES` 已包含 `auto-d2.js`，本次 51 op 可被自动加载。
- mock ctx 实测：总 op 354、D2 op 51、重复 id 0（总数包含并行批次 auto-d1/d3/d4）。
- 既有 `tests/selftest.mjs` 硬编码 `ops.length === 124`，在 auto 批次并行加入后会过期；按任务限制未修改该文件，交由集成方统一更新总数断言。

## 9. 文件变更

新增：

- `addons/dcode-extras-2026-10/ops/auto-d2.js`
- `addons/dcode-extras-2026-10/tests/auto-d2.selftest.mjs`
- `addons/dcode-extras-2026-10/report-d2.md`

未修改其它文件；未 commit/push；未永久删除。
