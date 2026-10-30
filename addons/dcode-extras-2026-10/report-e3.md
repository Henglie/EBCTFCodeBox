# Agent E3 · D3 blocked 条目攻坚批（2026-10）

- 日期：2026-10-30
- 范围：D3 遗留的 **41 个 blocked 条目**逐条重审；另把 D3 只做组合枚举的 **Kakuro** 升级为整盘求解。
- 产出：**11 个新 `e3-*` op** + **42 条 E3 台账**。
- 结论：**42 条台账 = implemented 12 / mapped 7 / blocked 23**；其中 41 个 D3 blocked 条目重审结果为 **implemented 11 / mapped 7 / blocked 23**，另 1 条 Kakuro 升级为 implemented。
- 未改 `index.js`、`official.json`、既有 `ops/`、`tests/`、`README`、`src/**`、`library`、`stage`；未 commit/push。

## 0. 口径

| 状态 | 含义 |
|---|---|
| `implemented` | 本批 `auto-e3.js` 的新 op 直接实现确定性核心；已知向量/往返在 `auto-e3.selftest.mjs` |
| `mapped` | 本批新 op 只覆盖确定性核心，或复用既有插件 op；括注写明缺口（如无私有线索库、非图形乐谱） |
| `blocked` | 需图片/OCR/音频/外部 DNS/运营商库/专有规则库/未公开规范；不伪造结果 |

E3 台账是 D3 `COVERAGE` 中 41 条 `blocked` 的**逐条重审**，不是全量 264 条重抄。已用脚本核对：D3 的 41 条 blocked 与 E3 的 41 条重审条目在 `cat + name + slug` 上**完全一致，无缺失、无多出**。

## 1. 计数

| 口径 | 条目 | implemented | mapped | blocked |
|---|---:|---:|---:|---:|
| D3 blocked 重审 | 41 | 11 | 7 | 23 |
| Kakuro 升级（D3 原 mapped 部分） | 1 | 1 | 0 | 0 |
| **E3 台账合计** | **42** | **12** | **7** | **23** |

按 D3 全量 264 条台账投影（不是 E3 重抄 264 条，而是用 D3 基线 + E3 delta 计算）：

| 口径 | implemented | mapped | blocked | 合计 |
|---|---:|---:|---:|---:|
| D3 基线 | 127 | 96 | 41 | 264 |
| E3 delta（blocked 重审 + Kakuro 升级） | +12 | +6 | -18 | 0 |
| **投影全量** | **139** | **102** | **23** | **264** |

说明：blocked 重审 11 条转 implemented、7 条转 mapped（blocked -18）；Kakuro 由 mapped 转 implemented（implemented +1、mapped -1）。因此全量投影为 **139 / 102 / 23**。

## 2. 新增 11 个 op

| op id | 分类 | 覆盖的 dCode 条目 | 核心 |
|---|---|---|---|
| `e3-fillapix` | cat-game | Solveur Fill-A-Pix | 3×3 窗口数字线索回溯+传播；支持含/不含中心格 |
| `e3-tectonic` | cat-game | Solveur Tectonic | Suguru/Tectonic：区域唯一、8 邻域不重复、正交不连续 |
| `e3-sudoku-regions` | cat-game | Sudoku 5×5 / 7×7 / NxN Irrégulier | 任意 N×N 区域图（2..16）数独 |
| `e3-keyrecover` | cat-text | Clé de Transposition | 列移位列序枚举 2..8；crib/词表/双字母评分 |
| `e3-mrz` | cat-text | Carte d'Identité Européenne / Française | TD1/TD2/TD3 MRZ 解析、校验位、复合校验位 |
| `e3-minesweeper` | cat-game | Solveur Picture Sweep | 数字扫雷单格推演 + 回溯求一致布雷 |
| `e3-hexword` | cat-game | Solveur AlphaBetty / Alphamo | 六边形 6 邻接路径搜词；词表自带 |
| `e3-crossword` | cat-game | Solveur de Codycross / Mots-Croisés | 网格词槽 + 候选词表回溯填字 |
| `e3-kakuro` | cat-numeral | Solveur de Kakuro | 整盘 Kakuro 回溯 + 组合可行性剪枝 |
| `e3-guitar` | cat-text | Notation des Accords de Guitare | 和弦构成音 + 标准调弦 0..12 品指法/ASCII 指板 |
| `e3-staff` | cat-text | Partition/Portée de Musique | 音符 → 音名/MIDI/ABC/ASCII 五线谱；非图形渲染 |

## 3. 41 个 D3 blocked 的重审结果

### 3.1 转为 implemented（11 条）

| 条目 | op | 说明 |
|---|---|---|
| Solveur AlphaBetty（Mobile） | `e3-hexword` | 六边形路径核心；不内置私有词库/计分 |
| Solveur AlphaBetty（Lettres） | `e3-hexword` | 同上 |
| Alphamo | `e3-hexword` | 六边形路径核心；不内置专有词盘/计分 |
| Solveur Fill-A-Pix | `e3-fillapix` | 3×3 窗口回溯；含/不含中心格可选 |
| Solveur Sudoku 5x5 | `e3-sudoku-regions` | 用户给区域图，支持非标准宫格 |
| Solveur Sudoku 7x7 | `e3-sudoku-regions` | 用户给区域图 |
| Solveur Sudoku NxN Irrégulier | `e3-sudoku-regions` | 任意 2..16 阶区域图 |
| Solveur Tectonic | `e3-tectonic` | 区域唯一 + 8 邻域不重复 + 正交不连续 |
| Clé de Transposition | `e3-keyrecover` | 列序枚举 + crib/词表/双字母评分 |
| Carte d'Identité Européenne | `e3-mrz` | TD1/TD2/TD3 MRZ 与校验位 |
| Notation des Accords de Guitare | `e3-guitar` | 和弦构成音 + 算法生成指法，不用和弦图数据库 |

### 3.2 转为 mapped（7 条）

| 条目 | 指向 | 缺口 |
|---|---|---|
| Solveur de Codycross（Mobile） | `e3-crossword` | 有网格+候选词填充；不内置 Codycross 线索答案库 |
| Solveur de Codycross（Lettres） | `e3-crossword` | 同上 |
| Solveur de Mots-Croisés | `e3-crossword` | 有网格+词表填充；不内置填字线索库 |
| Solveur Picture Sweep | `e3-minesweeper` | 有数字扫雷核心；不重建隐藏图片 |
| Carte d'Identité Française | `e3-mrz` | 法国身份证的 TD1 MRZ 可解析；卡号/卡面版式未覆盖 |
| Chiffres Miroir | `d1-mirror-digits` | 复用既有插件 op（0↔0 1↔1 2↔5 5↔2 6↔9 8↔8 9↔6） |
| Partition/Portée de Musique | `e3-staff` | 文本/ABC/ASCII 五线谱；不生成图形乐谱或字体 |

### 3.3 仍 blocked（23 条）

| 分组 | 条目 | 原因 |
|---|---|---|
| 专有游戏 | Solveur Fling | 弹球物理/盘面格式未公开 |
| 专有游戏 | Harry - Le Jeu | 规则/棋盘未公开 |
| 图片线索 | Solveur Figguess | 图片语义库缺失 |
| 专有配对 | Solveur de Mots Couplés | 配对规则未公开 |
| 自描述句 | Générateur d'Autogramme（Lettres + Nombres，2 条） | 受约束自然语言不动点，无公开确定性生成算法；不硬编码答案 |
| 网络/号码库 | Enregistrements DNS | 需 DNS 查询，违反纯前端零外发 |
| 网络/号码库 | Géolocalisation d'un Numéro de Téléphone | 需运营商/号码段库或外部 API |
| 口音改写 | Accent Allemand / Anglais / Asiatique / Espagnol / Etranger / Français / Italien / Russe（8 条） | dCode 专有谐音改写规则未公开 |
| 字符参考 | Caractères des Alphabets Etrangers | 参考/输入表，非确定性算法 |
| 字体映射 | Ecriture Dotsies | Dotsies 映射非 Unicode 标准，缺少可核验文本表 |
| 虚构语言 | Langage de Shankar | 映射未公开 |
| 三维立方体 | Rotation du Cube | 输入格式/旋转规则未文档化 |
| 音节切分 | Séparateur de Syllabes | dCode 算法未公开；插件 `d4-syllables` 是启发式，不等同 dCode 结果，故不冒充精确映射 |
| 乐谱密码 | Chiffre par Partition Musicale | 存在多个不兼容变体，未核实唯一映射 |
| 冷门符号 | Code Acéré | 多个互不兼容变体，无公开唯一规范 |

## 4. 额外升级

| 条目 | D3 原状态 | E3 状态 | 说明 |
|---|---|---|---|
| Solveur de Kakuro | mapped 到 `game-kakuro`（仅组合枚举） | implemented `e3-kakuro` | 新增整盘回溯求解：A/D 线索、1..9 不重复、组合可行性剪枝 |

## 5. 测试与验证

```text
node --check addons/dcode-extras-2026-10/ops/auto-e3.js
# exit 0

node --check addons/dcode-extras-2026-10/tests/auto-e3.selftest.mjs
# exit 0

node addons/dcode-extras-2026-10/tests/auto-e3.selftest.mjs
# AUTO-E3 SELFTEST PASS 351/351 assertions
```

覆盖内容：

- 11 个 op 的已知向量/往返/结构断言：Fill-A-Pix 全黑/全空/矛盾、Tectonic 6×6 已知解、5×5/7×7 区域数独、列移位 `HELLOWORLD` 恢复与列序 `[2 1 0]`、TD3/TD1 MRZ 全字段与校验位、扫雷单格/唯一解/多解、六边形 CAT/ARE/DOG、填字 CAT/ARE/TEN 词方阵与无解、Kakuro 4×4 已知解、C/Am/G7/F#m7b5 和弦与 `x32010`、C4..C5 ABC/ASCII 五线谱。
- 台账结构：42 条、12/7/23、URL 由 slug 生成、implemented op 均存在、mapped 有指向、blocked 有原因、无“台账缺失”内部缺口。
- 手工集成：用 mock ctx 动态加载 `index.js`，11 个 `e3-*` 全部注册（插件总注册数随其他批次变化，不作为固定断言）。
- 既有聚合测试 `tests/selftest.mjs` 仍硬编码 `ops.length === 355`；E3 注册 11 个新 op 后实际为 408，因此该聚合测试只剩这一条计数断言失败。按任务规则未修改既有测试；E3 专项 selftest 351/351 通过。

## 6. 明确限制

- **词表**：`e3-hexword`、`e3-crossword` 必须由用户在 `===` 后提供候选词表；不内置游戏私有词典/线索答案库。
- **Fill-A-Pix**：默认按标准 3×3 窗口（含中心格）；可切到仅 8 邻域。线索数字本身也作为可填格参与求解。
- **Tectonic**：采用 Suguru/Tectonic 常用规则（区域唯一、8 邻域不重复、正交相邻不连续）；区域图由用户提供，不校验区域连通性。
- **数独区域**：任意区域图，不限于矩形宫；5×5/7×7 的 dCode 专有区域布局需用户按页面抄入。
- **列移位密钥恢复**：密文按“逐行写入、按列序读出”的列移位实现；默认最大列数 8，排列数上限 200000，超 15 秒显式报错。无 crib/词表时用双字母频率，短文本可能多解。
- **MRZ**：只解析 TD1/TD2/TD3 机读区与校验位；不解析各国卡面、芯片、二维码或身份证号码规则。
- **Picture Sweep**：只实现数字扫雷核心；不重建隐藏图片。
- **吉他**：指法由 0..12 品枚举+评分生成，不是官方和弦图数据库；特殊调弦/高把位扩展未覆盖。
- **五线谱**：输出文本/ABC/ASCII，不生成图片或字体；不处理调号、拍号、连音、和弦等完整排版。
- **Kakuro**：token 格式为 `#` / `.` / `A12` / `D3` / `A12D3`；词槽长度 ≤9，网格规模受 2e6 节点上限约束。

## 7. 文件

| 文件 | 说明 |
|---|---|
| `addons/dcode-extras-2026-10/ops/auto-e3.js` | 11 个 `e3-*` op + `export const OPS` + `export const COVERAGE`（42 条台账） |
| `addons/dcode-extras-2026-10/tests/auto-e3.selftest.mjs` | 351 条断言；覆盖全部 11 op 与台账结构 |
| `addons/dcode-extras-2026-10/report-e3.md` | 本报告 |

未修改 `index.js`、`official.json`、既有 `ops/`、`tests/`、`README`、`src/**`、`library`、`stage`；未 commit/push。
