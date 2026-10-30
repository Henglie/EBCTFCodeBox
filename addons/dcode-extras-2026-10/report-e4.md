# Agent E4 报告 · dCode 全量插件复制（D4 blocked 清零批）

日期：2026-10-30
范围：`auto-d4.js` 中 90 条 `blocked` 分类归属（75 个去重工具），并核对 D4 21 个数据/编码/密码/格式分类的 402 条是否有漏项。
定位：dCode 独立插件内的纯 JS 增量批，不是主程序 op，也不是 dCode 全站复刻。

## 交付文件

- `addons/dcode-extras-2026-10/ops/auto-e4.js`
- `addons/dcode-extras-2026-10/tests/auto-e4.selftest.mjs`
- `addons/dcode-extras-2026-10/report-e4.md`

未修改 `index.js`、`official.json`、既有 ops/tests/reports/README、`src/**`、library、stage；未提交 git；未删除文件。

`index.js` 的 `AUTO_BATCHES` 原本已包含 `auto-e4.js`，本批不碰注册入口。

## 结果总览（E4 口径）

| 指标 | 分类条目 | 去重工具 |
|---|---:|---:|
| D4 原 blocked | 90 | 75 |
| E4 新增 implemented | 16 | 13 |
| E4 改判 mapped | 5 | 5 |
| E4 仍 blocked | 69 | 57 |
| 合计 | 90 | 75 |

- E4 `COVERAGE` 恰好 90 条，全部为 `implemented | mapped | blocked`，无静默丢弃。
- 16 条 implemented 全部指向本批存在的 `dcode-extras-2026-10/e4-*` op；13 个 op 全部至少覆盖一条工具。
- 5 条 mapped 全部有非空 `target`；69 条 blocked 全部有非空 `reason`。
- 同一工具跨分类重复计入行数；去重统计用于看真实工具数。

## 与 D4 合并后的总账

D4 原台账：402 条分类归属 / 351 个去重工具，137 implemented、175 mapped、90 blocked（去重 124/152/75）。

| 口径 | implemented | mapped | blocked | 合计 |
|---|---:|---:|---:|---:|
| 分类条目（D4+E4） | 153 | 180 | 69 | 402 |
| 去重工具（D4+E4） | 137 | 157 | 57 | 351 |

合并后 402 条仍全部有状态；E4 没有把 D4 的 implemented 重新记成 mapped，也没有重复造已有 op。

漏项核对：把 `dcode_tools.txt` 中 D4 的 21 分类 402 行与 `auto-d4.js` 的 402 条逐 slug 对比，没有发现真实漏项；差异仅为 4 个外链 URL 归一化条目（PayPal、Discord、Prise2Tete、Wikipedia），D4 已按外链/空 slug 记录，E4 继续按 blocked 保持。

## 关键发现：D4 有 5 个 blocked 其实已有现成实现

逐条核对主程序 registry 与既有 addon op 后发现，D4 的 blocked 里有 5 个工具并非真正缺实现，E4 直接映射，不重复实现：

| blocked slug | 现成目标 | 说明 |
|---|---|---|
| `chiffre-swagman` | `dcode-extras-2026-10/d1-swagman` | D1 已实现 Swagman 拉丁方阵 |
| `solveur-wordament` | `dcode-extras-2026-10/d3-boggle` | D3 Boggle 已明确覆盖 Wordament 路径规则 |
| `keysmash-clavier` | `dcode-extras-2026-10/txt-keysmash` | 既有 texttool 随机键盘串 |
| `4-quatre-elements` | `dcode-extras-2026-10/d1-four-elements` | D1 已实现四元素符号 |
| `miniature-exif` | `imageThumb` | 主程序 R18 已支持 JPEG APP1 IFD1 / JFIF APP0 / PNG eXIf 缩略图提取 |

这 5 条在 D4 报告里被标成 blocked，属于台账滞后，不是本批新增能力。

## 本批新增 13 个 op

| op | 算法 | 已知答案 / 测试 |
|---|---|---|
| `e4-code93` | Code 93 9 模块码字、C/K 模 47 校验、Full ASCII 前缀扩展 | `CODE93` 模块串与 bwip-js `includecheck=true` 逐位一致：`1010111101101000101001011001100101001100100101000010101010000101000101101100110101010111101`；全 ASCII 0–127 往返 |
| `e4-codabar` | Codabar 7 元素宽度码，宽元素按 3 模块展开 | `0` 的宽度串 `1111122`、模块串 `101010001110`（dCode 示例）；全字符往返 |
| `e4-postal-fr` | 法国邮政 4 态条码，4 竖线 + 2 点，从右向左读 | `75001` ↔ `.|.||| ..|||| ..|||| |.|.|| ||..||`（dCode 示例） |
| `e4-trevanion` | 标点后第 N 个字母提取 | N=3 示例 → `DCODE`；N=1 示例 → `CAÇHE` |
| `e4-digrafid` | 3×9 / 9×3 双格 + 3×3 数字格、6 字母分块、三 triplet 行列转置 | `DCODE` → `MOLGAZ`，`MOLGAZ` → `DCODE`（dCode 示例）；关键字格往返 |
| `e4-charabia` | 单词倒序 + 拉丁后缀 | `LATIN` + `US` → `NITALUS` → `LATIN`；`UM`/`AE` 解码 |
| `e4-alphuck` | Alphuck → Brainfuck 执行 | `e`×65 + `j` → `A` |
| `e4-binaryfuck` | 3 位 Binaryfuck → Brainfuck 执行 | dCode 示例位串 → `BIN` |
| `e4-pikalang` | Pikalang 词 → Brainfuck 执行 | dCode 示例程序 → `Pokemon` |
| `e4-reversefuck` | ReverseFuck 取反映射 → Brainfuck 执行 | `+`×65 + `.` 取反后 → `A` |
| `e4-crypt` | `$1$` MD5-crypt、`$5$` SHA-256-crypt（含 rounds） | `$1$secret$xoy1MxMutYIelML2TYUkO.`；`$5$secret$BG4MkQdYxdLv2KOoRkK.3omTkZhME3rKNpREJ3pgmI8`；`rounds=1000` 向量 |
| `e4-geek` | Geek Code 最长前缀类别解析 + `+/-/数值/@/$/?/*/!` 等级 | `C+++` → 计算机 +3；`d--` → 着装 -2；`a22` → 年龄 22；`GCS` 标头 |
| `e4-pairs` | 固定搭档单循环圆桌法赛程 | 4 队 3 轮；奇数队轮空 |

实现均为真实算法，无占位、无随机伪造输出。Brainfuck 解释器有界：30000 格、默认 500 万步、输出 1MB；超限显式报错。Code93 / Codabar / 法国邮政输出模块串或宽度串，不声称生成 PNG；PNG 渲染仍归主程序 `barcodeGen`。

## implemented 行覆盖明细

- `e4-code93`：`code-barres-code-93`（Codage + Image，2 条）
- `e4-codabar`：`code-barres-codabar`（Codage + Image，2 条）
- `e4-postal-fr`：`code-barres-postal-francais`（Codage + Image，2 条）
- `e4-trevanion`：`chiffre-trevanion`
- `e4-digrafid`：`chiffre-digrafide`
- `e4-charabia`：`charabia-latin`
- `e4-alphuck`：`langage-alphuck`
- `e4-binaryfuck`：`langage-binaryfuck`
- `e4-pikalang`：`langage-pikalang`
- `e4-reversefuck`：`langage-reversefuck`
- `e4-crypt`：`fonction-hachage-crypt`
- `e4-geek`：`code-geek`
- `e4-pairs`：`generateur-championnat-paires`

## mapped 行覆盖明细

- `keysmash-clavier` → `dcode-extras-2026-10/txt-keysmash`
- `solveur-wordament` → `dcode-extras-2026-10/d3-boggle`
- `chiffre-swagman` → `dcode-extras-2026-10/d1-swagman`
- `4-quatre-elements` → `dcode-extras-2026-10/d1-four-elements`
- `miniature-exif` → `imageThumb`

## 仍 blocked 的 69 条（57 个去重）

| 组原因 | 行 | 去重 | slugs |
|---|---:|---:|---|
| dCode 站点导航/FAQ/外链，非算法工具 | 22 | 14 | `a-propos`、`application-mobile`、`liste-outils`、`fr`、`#f0`–`#q5`、PayPal、`javascript:;`、Discord、空 slug（Prise2Tete/Wikipedia 外链） |
| 需要栅格图像/像素/OCR/图像数据集 | 8 | 8 | `canaux-cmjn`、`canaux-tsl`、`drapeaux`、`histogramme-image`、`format-cpbitmap`、`image-pixels-aleatoires`、`lecture-pixel-image`、`ocr-reconnaissance-de-caracteres-texte` |
| 语言口音/发音参考页 | 8 | 8 | `accent-allemand`、`accent-anglais`、`accent-asiatique`、`accent-hispanique`、`accent-etranger`、`accent-francais`、`accent-italien`、`accent-russe` |
| 字形仅以图片给出，无可核实文本映射 | 6 | 6 | `marquage-alpha-angle`、`code-chappe`、`ecriture-dotsies`、`chiffre-friderici-fenetres`、`numeration-dni`、`lspk90-h-leet-speak-90-degres-horaire` |
| dCode 专题/多算法综述页 | 5 | 3 | `chiffrements-moyen-age`、`chiffrements-multi-couches`、`chiffrement-dissimulation` |
| 构造语言/虚构文字/手语 | 4 | 4 | `langue-ithkuil`、`langage-iokharique`、`langue-des-signes-americaine`、`langue-des-signes-francaise` |
| 按字符形状/笔画数编码，无唯一映射 | 3 | 2 | `binaire-forme-caractere`、`chiffre-traits-lettre` |
| 图形/多项式/图形记谱 | 2 | 2 | `notation-laban`、`notation-noeuds` |
| 需执行 JavaScript（安全边界外） | 2 | 2 | `desobfuscateur-javascript`、`langage-hodor` |
| dCode 明言未解决的密码 | 2 | 1 | `chiffre-mccormick`（页面只有手稿转录，无解码工具） |
| 视力表图像/字体 | 2 | 2 | `echelle-monoyer`、`echelle-snellen` |
| HTML/JS 编辑器 UI | 2 | 2 | `editeur-html`、`editeur-javascript` |
| 文件创建/下载 UI | 1 | 1 | `fichier-donnees` |
| Kryptos 特定雕塑，K4 密钥/分段未完整公开 | 1 | 1 | `sculpture-kryptos` |
| 完整解释器/语言运行时未实现 | 1 | 1 | `shakespeare-langage-programmation` |
| **合计** | **69** | **57** | |

没有用 OCR/QR/图像解码/音频模型造假；这些条目保持 blocked。

## 验证

```text
node --check (auto-e4.js 复制为临时 .mjs)      OK
node addons/dcode-extras-2026-10/tests/auto-e4.selftest.mjs
                                                SELFTEST PASS 82/82
import(ops/auto-e4.js)                          OPS=13 COVERAGE=90
COVERAGE_STATS.byStatus                         implemented=16 mapped=5 blocked=69
COVERAGE_STATS.unique                           implemented=13 mapped=5 blocked=57
COVERAGE_STATS.entries                          90
```

自测覆盖：13 个 op 全部有已知答案或往返断言；Code93 与 bwip-js 模块串逐位对照；MD5-crypt / SHA-256-crypt 对照 dCode/OpenSSL/passlib 向量；Binaryfuck 与 Pikalang 对照 dCode 页面示例输出；覆盖台账三态、目标存在性、原因非空、分类合法、去重统计均断言。

共享工作树还包含其它并行批次（E1–E3）的 op；既有 `tests/selftest.mjs` 仍硬编码 `355`，注册总数已随并行批次变化。该文件属于禁止修改范围，本批未改；它不是 E4 的验收脚本，E4 以 `tests/auto-e4.selftest.mjs` 为准。

## 已知近似与边界

- `e4-crypt` 只实现 `$1$` MD5-crypt 与 `$5$` SHA-256-crypt；`$2$` bcrypt、`$6$` SHA-512-crypt、2 字符 DES salt 明确报错，不冒充支持。
- `e4-code93` 输出 0/1 模块串与 C/K 校验；不生成 PNG。Full ASCII 按 Wikipedia Code 93 扩展表实现。
- `e4-codabar` 输出宽度串/模块串；宽元素按 3 模块展开以对齐 dCode 的 `0 → 101010001110` 示例。
- `e4-trevanion` 只做提取；没有载体文本时不伪造可逆编码。
- `e4-charabia` 的后缀集合是常见拉丁词尾，解码存在固有歧义；报告与 op desc 已注明。
- `e4-geek` 输出结构化类别/等级解析，不逐字复刻 dCode 每个类别的整段散文翻译。
- `e4-pairs` 是固定搭档赛程，不做每轮换搭档的 whist/americano 轮转。
- Brainfuck 家族解释器有界；死循环、越界、括号不配对、超步数均显式报错。

## 未完成声明

本批只对 D4 原 90 条 blocked 分类归属（75 个去重工具）负责。E4 后仍有 69 条分类归属（57 个去重工具）blocked，已逐条给出原因；没有以占位实现冒充完成，也没有把图像/OCR/音频/模型类工具标成已实现。

