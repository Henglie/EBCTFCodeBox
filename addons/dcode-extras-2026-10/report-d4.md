# Agent D4 报告 · dCode 全量插件复制（批 4）

日期：2026-10-30
范围：`资料/工程留存/T508/dCode全量分类清单.md` 与 `dcode_tools.txt` 中分配给 D4 的 21 个分类。
定位：dCode 独立插件内的纯 JS 全量覆盖批次，不是主程序 op，也不是 dCode 1308 工具全站复刻。

## 交付文件

- `addons/dcode-extras-2026-10/ops/auto-d4.js`
- `addons/dcode-extras-2026-10/tests/auto-d4.selftest.mjs`
- `addons/dcode-extras-2026-10/report-d4.md`

未修改 `index.js`、`official.json`、既有 ops/tests/README、`src/**`、library、stage；未提交 git。

`index.js` 的 `AUTO_BATCHES` 已包含 `auto-d4.js`，运行时自动加载本批，无需改注册入口。插件 manifest 文案仍写 124 op，属于本次禁止修改范围，未改。

## 结果总览

| 指标 | 数量 |
|---|---:|
| 分类归属条目 | 402 |
| 去重工具数 | 351 |
| 新增 op | 109 |
| 自测断言 | 210 |
| implemented（分类条目 / 去重） | 137 / 124 |
| mapped（分类条目 / 去重） | 175 / 152 |
| blocked（分类条目 / 去重） | 90 / 75 |

402 条分类归属全部有状态，无静默丢弃。同一工具出现在多个分类时按分类各记一条；去重统计用于看真实工具数。`COVERAGE` 在模块加载时对缺失分类直接抛错，防止后续维护时漏项。

## 验证

```text
node --check (temp .mjs copy)                  OK
node tests/auto-d4.selftest.mjs                SELFTEST PASS 210/210
import(ops/auto-d4.js)                         OPS=109 COVERAGE=402
```

覆盖不变量：

- 402 条全部为 `implemented | mapped | blocked`。
- 137 条 implemented 全部指向本批存在的 `dcode-extras-2026-10/d4-*` op。
- 109 个 op 全部至少覆盖一个工具，无孤立 op。
- mapped 全部有非空 `target`；blocked 全部有非空 `reason`。
- 所有 op id 的本地 slug 以 `d4-` 开头（完整 id 为 `dcode-extras-2026-10/d4-*`）。

## 分类明细

| 分类 | 总数 | implemented | mapped | blocked |
|---|---:|---:|---:|---:|
| Traitement de Données (Autre/non classé) | 53 | 49 | 4 | 0 |
| Codage de Caractères | 44 | 8 | 33 | 3 |
| Informatique (Autre/non classé) | 28 | 7 | 19 | 2 |
| Système de Notation | 28 | 18 | 6 | 4 |
| Traitement d'Image | 28 | 3 | 13 | 12 |
| dCode | 27 | 2 | 0 | 25 |
| Compression | 23 | 12 | 10 | 1 |
| Système de Communication (Autre/non classé) | 21 | 1 | 7 | 13 |
| Stéganographie | 21 | 12 | 3 | 6 |
| Chiffrement par Transposition | 19 | 6 | 11 | 2 |
| Langage de Programmation | 18 | 0 | 11 | 7 |
| Cryptographie Moderne | 16 | 1 | 14 | 1 |
| Système de Numération | 12 | 0 | 11 | 1 |
| Chiffrement Polygrammique | 11 | 0 | 9 | 2 |
| Données Brutes | 11 | 3 | 2 | 6 |
| Electronique | 11 | 7 | 4 | 0 |
| Cryptographie (Autre/non classé) | 10 | 5 | 2 | 3 |
| Cryptanalyse | 7 | 1 | 6 | 0 |
| Fonction de Hachage | 6 | 1 | 5 | 0 |
| Somme de Contrôle | 5 | 1 | 4 | 0 |
| Geek | 3 | 0 | 1 | 2 |
| **合计** | **402** | **137** | **175** | **90** |

## 本批实现（109 op）

### 数据处理 / 文本（46）

`acronym`、`expr-frac`、`round`、`count-substr`、`word-count`、`text-diff`、`list-dupes`、`block-split`、`text-split`、`plagiarism`、`set-diff`、`set-common`、`letter-extract`、`typo-gen`、`combo-filter`、`homoglyph`、`abbrev`、`markov`、`benford`、`confusion`、`list-stats`、`metaphone`、`char-count`、`numbers-ending`、`odd-even`、`common-substr`、`precision-recall`、`lang-detect`、`sign`、`simplify-frac`、`soundex`、`strip-spaces`、`syllables`、`comma-sep`、`sort-letters`、`sort-list`、`pass-variants`、`vowel-consonant`、`strip-zeros`、`bit-positions`、`lfsr`、`android-pattern`、`uuid`、`int32`、`bitcalc`、`keypad-art`

### 编码 / 压缩 / 数学（27）

`zbase32`、`excess3`、`zalgo`、`zwsp`、`barcode1d`（EAN-8 / POSTNET / PLANET 模块串与校验位）、`base26`、`base37`、`fib-coding`、`negafib-coding`、`kaprekar`、`polya`、`tournament`、`round-robin`、`americano`、`life`、`syllogism`、`random-sample`、`random-digits`、`draw`、`insee`、`parsons`、`postal-fr`、`codons`、`electron-config`、`bounds`、`number-sets`、`knuth`

### 记数 / 电子 / 校验（24）

`san`、`uci`、`fen`、`rpn`、`chords`、`atomic-number`、`barcode-country`、`digit-rank`、`boolean`（求值 / 真值表 / 对偶）、`minterms`、`kmap`（Quine–McCluskey）、`resistor`、`capacitor`、`rib`、`diffie-hellman`、`cipher-identify`、`caesar-box`、`ubchi`、`spiral`、`transposition-key`、`route-path`、`boustrophedon`、`mirror-text`、`reverse-text`

### 隐写 / 黑话 / 卡片（12）

`upside-down`、`alphagram`、`anagram`、`anacyclique`、`palindrome-gen`、`javanais`、`louchebem`、`pig-latin`、`tarot`、`playing-cards`、`money`、`scramble-alphabet`

实现均为真实算法，无占位、无随机伪造输出。所有搜索/生成有界（排列、K-map 变量数、Knuth 箭头、LFSR 输出、UUID、随机抽样等）；超限显式报错。随机类使用 `lib/util.js` 的统一 `randomBytes` 源。

## mapped 口径

`mapped` 表示该 dCode 工具已由主程序或既有 addon op 覆盖，本批不重复造轮子。`COVERAGE[].target` 给出去向，常见目标包括：

- 编码：`base32`、`base45`、`base58`、`base62`、`base64`、`base85`、`base91`、`base92`、`base100`、`base65536`、`crockford32`、`ebcdic`、`unicodeEscape`、`uuencode`、`punycode`、`varint`
- 条码/图像：`barcodeGen`、`ean13`、`qrGen`、`pngChunkList`、`exifExtract`、`imageBasic`、`imageGray`、`imageToData`、`bin2img`
- 压缩：`rle`、`lzw`、`bwt`、`huffmanCodec`、`deflateRawCodec`、`gzipCodec`、`zlibCodec`、`elias`
- 古典：`adfgx`、`adfgvx`、`amsco`、`doubleTrans`、`railFence`、`redefence`、`scytale`、`skipCipher`、`columnar`、`turningGrille`、`playfair`、`foursquare`、`bifid`、`pollux`、`twosquare`、`threeSquare`、`morbit`、`collon`
- 现代/哈希/校验：`rc4`、`rsa`、`xor`、`x509Parse`、`md4`、`md5`、`sha1`、`sha256`、`sha512`、`pbkdf2`、`ntlm`、`luhn`、`verhoeff`、`crc32`、`iban`
- 记数/符号：`roman`、`chineseNum`、`babylonianNumerals`、`mayaNumerals`、`egyptianNumerals`、`braille`、`natoAlphabet`、`semaphore`、`marineFlags`、`leetSpeak`、`wingdings`、`cardanGrille`、`astroSymbols`
- addon 既有：`num-sevenseg`、`num-bengali`、`num-frenchwords`、`num-kaktovik`、`num-cistercian`、`num-shadok`、`num-soroban`、`num-powers10`、`num-tally`、`sym-hexagram`、`sym-braille-gs8`

主程序 op 的覆盖关系按仓库现有 registry/manifest 标注，未在本批内重新跑主程序回归。已核对 139 个 mapped 目标 id 均能在 `src/core/**` 或既有 addon ops 中找到注册点（`columnar`/`playfair` 经 `regKey` 注册）。若主程序后续改名/删除，`COVERAGE[].target` 需要同步维护。

## blocked 口径

blocked 只在两类情况下使用：

1. 需要图像/OCR/音频/二进制/模型/站点 UI，纯文本 op 无法诚实承载。
2. 缺少可核实的算法表/码表，拒绝猜测输出。

主要 blocked 组：

- dCode 站点页/FAQ/外链/专题介绍：25 条（`a-propos`、`application-mobile`、`liste-outils`、`fr`、`#f0`–`#q5`、`chiffrements-*`、支付/Discord 外链等）。
- 图像栅格/OCR/EXIF 缩略图/CPBitmap/随机像素/像素读取：12 条；另 `canaux-cmjn`、`canaux-tsl`、`drapeaux` 等。
- 语言/口音/手语/虚构文字：8 个 Accent 页、Chappe、Dotsies、Iokharic、ASL/FSL。
- 权威表缺失的古典/历史密码：Friderici、Trevanion、Swagman、Kryptos、Digrafid、McCormick、D'ni、Laban、结记谱、Alpha Angle、Ithkuil、Charabia Latin。
- 解释器/安全边界：Alphuck、Binaryfuck、Hodor、Pikalang、ReverseFuck、Shakespeare、JS 反混淆。
- 其他非算法或 UI：文件生成、Keysmash、HTML/JS 编辑器、Monoyer/Snellen 视力表、四元素编码、Geek Code、LSPK90、Unix `crypt(3)`、双人搭档轮转赛制。
- 条码制式表缺口：Code93、Codabar、法国邮政 4 态条码。

## 已知近似与歧义

- `lang-detect`、`syllables`、`metaphone`、`cipher-identify` 为启发式，不是 dCode 黑盒输出的逐字节复刻。
- `pig-latin`、`louchebem` 的还原存在固有歧义（原始辅音群/词尾辅音无法从密文唯一确定）；decode 明确按启发式处理，报告与 op 描述已注明。
- `negafib-coding` 使用有界 DFS 保证往返；极大输入会报错而非截断。
- `kmap` 使用 Quine–McCluskey + 贪心覆盖；对 1–4 变量给出 0/1/无关项的积之和，不保证与 dCode 的最小项排序逐字一致。
- `electron-config` 含常见例外（Cr/Cu/Nb/Mo/Ru/Rh/Pd/Ag/La/Ce/Gd/Pt/Au/Ac/Th/Pa/U/Np/Cm/Lr）；其余按 Aufbau。
- `cipher-identify` 只输出候选与置信度，不承诺唯一识别。

## 未完成声明

本批只对 D4 分配的 21 分类 402 条归属（351 个去重工具）负责，不代表 dCode 1308 工具全站完成。blocked 的 90 条分类归属（75 个去重工具）已逐条给出原因；没有以占位实现冒充完成。
