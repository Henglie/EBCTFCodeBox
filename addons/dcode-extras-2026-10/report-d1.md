# Agent D1 报告 · dCode 分配分类全量覆盖

日期：2026-10-30
范围：Substitution par Symboles（231）、Chiffrement par Grille（15）、Croyances（10）、Histoire (Autre/non classé)（7）、Chiffrement par Substitution Homophonique（6）。
源：`资料/工程留存/T508/dCode全量分类清单.md` + `dcode_tools.txt`（2026-09-11 快照）。

## 1. 结论

| 口径 | implemented | mapped | blocked | 合计 |
|---|---:|---:|---:|---:|
| 分类清单条目（含跨分类重复） | 34 | 111 | 124 | 269 |
| 去重 slug | 33 | 100 | 123 | 256 |

分类明细：

| 分类 | implemented | mapped | blocked | 条目 |
|---|---:|---:|---:|---:|
| Substitution par Symboles | 25 | 86 | 120 | 231 |
| Chiffrement par Grille | 3 | 12 | 0 | 15 |
| Croyances | 2 | 6 | 2 | 10 |
| Histoire (Autre/non classé) | 0 | 6 | 1 | 7 |
| Chiffrement par Substitution Homophonique | 4 | 1 | 1 | 6 |

269 条全部进入 `COVERAGE`，每条含 `cat/name/slug/url/status`；implemented/mapped 带 `op`，blocked 带 `reason`。未静默丢弃任何条目。

## 2. 新增 op（29 个，均为 `d1-` 前缀）

全部为纯 JS、无网络/运行时依赖；已知向量均写入自测。

| op | 覆盖工具 | 关键已知向量 |
|---|---|---|
| `d1-playfair` | Chiffre PlayFair | MONARCHY + HELLO → CFSUPM |
| `d1-albhed` | Langage Al Bhed | HELLO → RAMMU |
| `d1-code-claw` | Code de la Griffe (Gregor) | RAT → RBU；RBU → `\/ |\ //` |
| `d1-rank-anchor` | D3 / K7 / K6 / Indienne | DCODE → 3/2/14/3/4；K7 → 26/25/11/26/1；K6 → 25/24/10/25/26；N=1 → 17/16/2/17/18 |
| `d1-greek-rank` | Rang Alphabet Grec | αβγ → 1 2 3 |
| `d1-alpha-sum` | Rang Alphabétique Additionné | DCODE → 4/7/22/26/31 |
| `d1-cv-rank` | Rang Consonnes/Voyelles | DCODE → C3C2V4C3V2 |
| `d1-prime-subst` | Substitution par Nombres Premiers | ABC → 2 3 5 |
| `d1-prime-mult` | Multiplication Nombres Premiers | AB → 18；DCODE(mode4) → 5097877527832031250000 |
| `d1-mirror-digits` | Chiffres Miroir | 2026 → 5059 |
| `d1-ascii-shift` | Chiffre Décalage ASCII | A +40 → i |
| `d1-progressive-caesar` | Chiffre par Décalages | ABC（step=1）→ ACE |
| `d1-unicode-shift` | Décalage Unicode | dCode +1234 → ԶԕՁԶԷ |
| `d1-ascii-controls` | Caractères de Controles ASCII | 0/1/2/3 → NUL SOH STX ETX；␀␁␂␃ |
| `d1-word-pattern` | Désubstitution/Motif de Mot | BOB EVE → 010 010 |
| `d1-four-elements` | Les 4 Elements | earth fire → 🜃 🜂 |
| `d1-chinese-zodiac` | Signe Astrologique Chinois | 2024 → Dragon, Wood；2000 → Dragon, Metal |
| `d1-wolseley` | Chiffre Wolseley | SECRET + WOLSELEY → RFIZYIYE |
| `d1-swagman` | Chiffre Swagman | DCODESWAGMANCIPHER → DASHNECWAORCXGIDEPMX |
| `d1-grandpre` | Chiffre de Grandpré | 73 09 78 22 29 15 03 88 → GRANDPRE |
| `d1-rozier` | Chiffre Rozier | ROZIER + DCODE → QAOJDQ |
| `d1-tomtom` | Code Tom-Tom | TOMTOM → `\\/\ /\/ \// \\/\ /\/ \//` |
| `d1-naknak` | Code Nak Nak | Duck → Nak? Nak? Naknaknak nak? Naknak Nanananak Naknak nanak |
| `d1-cadran` | Cadran Chiffrant de l'Armée Mexicaine | AAAA/盘1：DCODE → 04 03 15 04 05；5681158231 → DCODE |
| `d1-nomenclature` | Chiffre par Nomenclature / Substitution par Mots | A=Alpha… + ABC → Alpha Bravo Charlie |
| `d1-tictactoe` | Chiffre Tic-Tac-Toe | TICTACTOE 结构式往返 |
| `d1-scream` | Code à Cris (xkcd) | SCREAM → ÃA̧ȂÁAǍ；A̱A̧ÅA̱Á → DCODE |
| `d1-mac-option` | Code Touche Option | Option → Øπ†ˆø˜；Âåç → Mac |
| `d1-modulo` | Chiffrement par Modulo | 654 965 561 732 941 mod 26 → DCODE |

实现来源纪律：
- 符号/字母表只用可核验的 Unicode/公开码位或主工具箱既有忠实映射；虚构字形页面仅提供位图 `char(N).png` 的，不猜字形。
- 算法类逐条对照 dCode 页面 FAQ/示例（本地 T508 缓存页 + 在线页面），已知向量写入 `auto-d1.selftest.mjs`。
- Grandpré/Swagman/Rozier/Wolseley/Tom-Tom/Nak-Nak/Scream/Mac Option/Cadran 的页面表与示例已逐项复现。
- `d1-prime-mult` 实现 mode1（字母素数^位置）与 mode4（位置素数^字母秩）；mode2/mode3 未实现，ledger 的 `note` 已注明。
- `d1-cadran` 第 4 盘 101–104 为空格位，编码时显式报错；与 dCode FAQ 一致。
- `d1-word-pattern` / `d1-nomenclature` 的候选词表/对照表由用户提供，未伪造内置词典。

## 3. mapped（112 条）

映射到主工具箱或本插件既有 op，均带精确 op id，例如：
`braille`、`semaphore`、`occult`（theban/lunaire/celestial/malachim）、`sga`、`alienAlphabet`、`futhark`、`hieroglyphs`、`marineFlags`、`countingRods`、`roman`、`babylonianNumerals`、`egyptianNumerals`、`mayaNumerals`、`element`、`musicNotation`、`astroSymbols`、`wingdings`、`base100`、`natoAlphabet`、`a1z26`、`caesar`、`rot5/13/18/47/8000`、`affine`、`atbash`、`bacon`、`polybius`、`tapCode`、`adfgx/adfgvx`、`bazeries`、`bifid/trifid`、`collon`、`vic`、`trilitere`、`monomeBinome`、`twinHex`、`nihilistCipher`、`twosquare/threeSquare`、`turningGrille`、`bookCipher`、`homophonic`、`trithemius`、`alberti`、`goldbug`、`dancingMen`、`zodiac`、`clockCipher`、`dtmf`、`morse/fracmorse/wabun`、`t9Phone`、`keyCode`、`keyboardShift/layoutMap/keyboardSurround`、`kenny`、`simplesub`、`gematria`/`math-wordvalue`，以及插件 `num-sevenseg/num-ogham/num-tifinagh/num-dice/num-domino/num-tally/num-kaktovik/num-cistercian/num-bibi/sym-altcodes/sym-hexagram/sym-klingon/sym-braille-gs8`。

## 4. blocked（124 条）

按原因分布：
- 83：dCode 仅位图/字体字形，缺少可核验权威文本或 Unicode 映射（虚构字母表、Gravity Falls、Genshin/Hylian、Templiers/Rose-Croix、Friderici、Betamaze、Birds、Mary Stuart 等）。
- 13：自然语言翻译/音译（Amharique、Malayalam、Sanskrit、Thai、Telugu、Inuktitut、Dothraki、Hodor/Shankar/Malespin 等）。
- 6：多互不兼容变体、无唯一文本表（Acéré、Elian、JIS Mikaka、Android 长按、二进制字符形状、LSPK90 等）。
- 5：图像/手势/乐谱/字体渲染（ASL/FSL、手写乐谱、Horloge Sémaphore、Ballet 等）。
- 5：需外部码本/词表（Chappe、Navajo×2、Mary Stuart、Wetterkurzschlussel）。
- 3：未破译/无公认映射（Voynich、Dorabella、Copiale）。
- 2：参考/索引/文档类（Chiffrements avec Symboles 索引、Notation des Noeuds）。
- 2：商业字体 cmap（Symbol、Webdings）。
- 1：通用可配置网格读取器（Coordonnées de Grille）。
- 1：3×3 点阵字形表不完整（Dessin sur Clavier Numérique）。
- 1：PGP 词表（参考数据，非编码算法）。
- 1：圣经全文检索。
- 1：需特定书籍同版式（Arnold）。

每条 blocked 的 `reason` 均给出具体原因，未用“未实现”糊弄。

## 5. 验证

- `node --check addons/dcode-extras-2026-10/ops/auto-d1.js`：OK
- `node --check addons/dcode-extras-2026-10/tests/auto-d1.selftest.mjs`：OK
- `node addons/dcode-extras-2026-10/tests/auto-d1.selftest.mjs`：**PASS 1589/1589 assertions**
- 插件 index mock 装载（本次快照）：355 op，`d1-*` 29 个全部注册，op id 无重复。
- 自测覆盖：29 个新 op 每个至少一条已知向量/往返；COVERAGE 完整性（269 条、分类计数、状态计数、implemented 引用存在、blocked reason 非空、mapped op 非空）。

## 6. 文件

- `addons/dcode-extras-2026-10/ops/auto-d1.js`（新增，`export const OPS` / `COVERAGE` / `COVERAGE_COUNTS` / `COVERAGE_CATEGORIES`）
- `addons/dcode-extras-2026-10/tests/auto-d1.selftest.mjs`（新增）
- `addons/dcode-extras-2026-10/report-d1.md`（本文件）

未修改 `index.js`、`official.json`、既有 ops/tests/README、`src/**`、library、stage；未 git commit/push；未永久删除任何文件。
