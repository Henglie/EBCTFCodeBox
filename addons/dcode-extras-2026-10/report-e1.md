# Agent E1 报告 · dCode 缺失 slug 收口（多表 + 地理）+ D1 Webdings 回收

日期：2026-10-30
范围：`资料/工程留存/T508/dcode_tools.txt` 中 D1–D4 台账未入账的 37 个 canonical slug（21 个 Chiffre Poly-Alphabétique、14 个 Géographie、2 个 dCode 站点页），并回收 1 个 D1 blocked 且 dCode 页面有公开文本映射的 slug（Police Webdings）。

## 1. 结论

| 口径 | implemented | mapped | blocked | 合计 |
|---|---:|---:|---:|---:|
| 本轮负责的 37 个缺失 slug | 8 | 22 | 7 | 37 |
| D1 blocked 回收（Webdings） | 1 | 0 | 0 | 1 |
| **本文件 COVERAGE** | **9** | **22** | **7** | **38** |

- 37 个 assigned slug 全部入账，无静默丢弃；`missing` 为 0（仅指这 37 个 assigned slug）。
- `COVERAGE` 在模块加载时对未分类 slug 直接抛错，防止后续维护漏项。
- 不声称 dCode 全站零缺口。按本地 `dcode_tools.txt` 的 984 个唯一路径 slug 口径，合并 D1–D4+E1 后覆盖 982/984；剩余 2 个路径键是 PayPal / Discord 外链，D4 已用 URL 键 / 空键记 blocked，不是算法缺口。

### 台账口径差异（如实记录）

- 本轮以 `资料/工程留存/T508/dcode_tools.txt` 为准：1308 行，去重 **984** 个 URL pathname slug。
- D1–D4 合并后（按 slug 去重，implemented > mapped > blocked）：**953** unique，`implemented=452 / mapped=289 / blocked=212`。
- 与任务书给的 `952/988（452/289/211）` 有 1–4 条差异，来源是快照版本与 URL 归一化：本地多出一个 D4 的 URL/空 slug 键，且本文件不含 D4 的非路径键（`#f0`–`#q5`、`webscr?...`、`AT9V5Vq`、空键）。
- 以上 984 路径 slug 与 D1–D4 的交集为 945，故路径口径 missing = 984 − 945 = **39**。其中 PayPal / Discord 是 D4 已 blocked 的非算法外链，扣掉后为任务书的 **37**。
- E1 后合并：**990** unique 键（含 8 个 D4 非路径键），`implemented=461 / mapped=311 / blocked=218`。比 D1–D4 的 953 增加 37 个 assigned slug；Webdings 由 blocked 翻 implemented 不增加 unique 总数。

## 2. 交付文件

- `addons/dcode-extras-2026-10/ops/auto-e1.js`（新增；`OPS=9`、`COVERAGE=38`、`COVERAGE_STATS`）
- `addons/dcode-extras-2026-10/tests/auto-e1.selftest.mjs`（新增；480 条断言）
- `addons/dcode-extras-2026-10/report-e1.md`（本文件）

未修改 `index.js`、`official.json`、既有 ops/tests/reports/README、`src/**`、library、stage；未 git commit/push；未删除任何文件。`index.js` 的 `AUTO_BATCHES` 已包含 `auto-e1.js`，运行时自动加载。

## 3. 新实现 op（9 个，均 `e1-` 前缀）

| op | 覆盖 slug | 实现要点 | 自测已知向量 / 往返 |
|---|---|---|---|
| `e1-mult-vigenere` | `chiffre-multiplication-vigenere` | 数字消息 × 循环数字密钥；decode 要求逐项整除；非整数/零密钥/溢出错 | `4 3 15 4 5` × `3 12 5` → `12 36 75 12 60`，反解回原串；`12 36 75 12 60` 反解 `4 3 15 4 5` |
| `e1-cesar-progressif` | `chiffre-cesar-progressif` | `start + step×序号`；逐字符 / 逐词 / 每 N 字符三种换挡；保留大小写与非字母 | `AAA`（start=3,step=1）→ `DEF`；`AAA`（start=0,step=3）→ `ADG`；逐词 `AA BB CC`→`BB DD FF`；每 2 字符 `AAAAA`→`BBCCD`；整串往返 |
| `e1-webdings` | `police-webdings`（D1 回收） | ASCII 32–126 + Latin-1 128–255 ↔ Webdings Unicode 表，共 223 槽；127 与超出 Latin-1 的码位报错；decode 去除 VS15/VS16 | `WEB` → `🕨🏜🏘`；`DINGBAT` → `🏚🏖👁🏛🏘🏗🛳`；223 槽全表往返且符号唯一；`é` ↔ `♿` |
| `e1-azimuth` | `azimut` | 两 GPS 点初始方位角、16 方位、后向方位、球面距离 | `0,0 → 0,90` = `90° / E / 270°`；Paris→London = `330.021°` |
| `e1-geo-calc` | `calcul-coordonnees-geographiques` | 球面中点；起点 + 方位角 + 距离 → 终点；默认 R=6371 km | dCode 中点算例 → `46.244119, 5.268505`；`0,0` 向东 111.1949 km → `0, 1` |
| `e1-antipodal` | `coordonnees-antipodales` | 纬度取反，经度 +180° 归一化到 [-180,180] | `-12.345,67.890` → `12.345, -112.11`；`0,0` → `0, -180` |
| `e1-haversine` | `distance-haversine` | Haversine 大圆距离，km/mi/圆心角，半径可调 | Paris→London `343.556 km`；`0,0→0,180` `20015.087 km` |
| `e1-dept-fr` | `departements-francais` | 法国 101 省 + 8 个海外集体；编号/名称双向；无重音/别名；留空或 `*` 列全表 | `75`→`Paris`；`2a`→`2A Corse-du-Sud`；`Côte-d'Or`→`21`；`Réunion`→`974`；全表 109 行（101 省 + 8 集体） |
| `e1-compass-route` | `parcours-boussole` | 8 方向路径求和、化简、总步数、直线距离、方位角；支持 `-`/空格分隔 | `40N-30E-20S-10O` → `20N, 20E`，总步数 100，直线 28.284，方位 45°；含 `16 SO` 长路径 |

实现均为纯 JS、无网络/运行时依赖；所有解析/生成有界，超限或非法输入显式报错。

## 4. mapped（22 条）

映射到主工具箱（878 op，按 `src/core/lazyTables.generated.js` 的 `OP_FILE_MAP` 实核 22/22 存在），不重复造 op：

| dCode slug | 目标主 op | 备注 |
|---|---|---|
| `chiffre-alberti` | `alberti` | `cipherAlphabet / initialShift / periodicShift / period` 与 dCode 算例 `DCODE→EDPGH` 对齐 |
| `chiffre-autoclave` | `autokey` | dCode Autoclave 即“密钥+明文” autokey |
| `chiffre-beaufort` | `beaufort` | 标准 Beaufort `c = k − p` |
| `chiffre-bellaso` | `bellaso` | 主件 Bellaso 互反多表 |
| `chiffre-chaocipher` | `chaocipher` | 主件双转盘 Chaocipher |
| `chiffre-ragbaby` | `ragbaby` | 主件支持 24/26 字母表、startShift、letterStep |
| `chiffre-slidefair` | `slidefair` | 主件 Slidefair 双字母 |
| `chiffre-solitaire-schneier` | `solitaire` | Schneier 官方向量 |
| `chiffre-variante-beaufort` | `beaufortVariant` | `c = p − k`，自反 |
| `chiffre-gronsfeld` | `gronsfeld` | 数字密钥 Vigenère |
| `chiffre-hill` | `hill` | 主件 Hill 方阵 |
| `chiffre-phillips` | `phillips` | 主件 Phillips |
| `chiffre-porta` | `porta` | 主件 Porta 自反表 |
| `chiffre-tritheme` | `trithemius` | A=0,1,2… 递进移位 |
| `chiffre-vernam` | `otp` | 字母 OTP；二进制 XOR 见 `xor`，短密钥循环变体见 `vigenere` |
| `chiffre-vigenere` | `vigenere` | 标准 Vigenère |
| `cylindre-jefferson` | `jefferson` | 主件杰斐逊轮盘 |
| `chiffre-decalage-mot-cle` | `vigenere` | dCode 页面说明即按关键词字母循环移位（A=0） |
| `chiffre-machine-enigma` | `enigma` | 主件 Enigma I 转子 I–V / UKW-B/C / ring / plugboard |
| `coordonnees-utm` | `geoUtm` | 主件 WGS84 UTM 双向 |
| `coordonnees-geohash` | `geoHash` | 主件 geohash base32 双向 |
| `code-open-location` | `geoPlusCode` | 主件 Open Location Code 双向 |

## 5. blocked（7 条，逐条原因）

| dCode slug | 原因 |
|---|---|
| `altitude-terre` | 需要 SRTM/IGN 等数字高程模型栅格数据，纯文本算法无法离线给出海拔 |
| `coordonnees-what3words` | What3Words 专有 3 词词表 + 在线解析服务，词表未公开且不可离线复现 |
| `distance-geographique` | dCode 页面是地址间驾车/步行/航线路径距离，需要地理编码与道路网络；不是 `distance-haversine` 的球面公式 |
| `geocodage` | 地址↔坐标需要外部地理编码数据库或联网服务，仓库未捆绑地址库 |
| `geolocalisation-coordonnees` | 坐标反查地点需要地图瓦片/反向地理编码服务，属于联网功能 |
| `Prise2Tete`（`http://www.prise2tete.fr/`） | 外部法语谜题站点，不是可逆算法或可离线复刻的工具 |
| `Wikipedia`（`https://fr.wikipedia.org/`） | 外部百科站点导航页，不是算法工具 |

`blocked` 每条均有非空 `reason`，没有用“未实现”糊弄。

## 6. D1 blocked 回收审查

本轮按要求复查 D1 blocked，只回收有公开文本映射且能逐字符核验的项：

| D1 slug | 处理 | 依据 |
|---|---|---|
| `police-webdings` | **blocked → implemented**（`e1-webdings`） | dCode 页面给出完整 ASCII/Latin-1 → Unicode Webdings 表；本轮实现 223 个槽位，全表往返 + 符号唯一自测通过 |
| `alphabet-moon` | 维持 blocked | dCode 页面是 William Moon 1845 盲文触觉字母，不是主件 `occult` 的 Leandro Katz Lunar（月相）字母；无公开 Unicode 文本表 |
| `dessin-clavier-numerique` | 不重复入账 | 合并台账中已由 D4 `d4-keypad-art` implemented；再加一行会双计 |
| `code-chappe` / `alphabet-chappe` | 维持 blocked | Code Chappe 依赖 dCode 特藏 92×92 词汇表（非原始 Chappe 词汇）；Alphabet Chappe 只有位图字形，无 Unicode 文本映射 |
| 其余 D1 blocked（虚构字母/手语/OCR/字体/未解密文/外部码本） | 维持 blocked | 仍缺可核验文本表或需要图像/OCR/外部数据，不能降级成猜测映射 |

因此本轮对 D1 blocked 的净减少为 **1**（Webdings），没有把无表的项硬改成 mapped 充数。

## 7. 验证

```text
node --check (ops/auto-e1.js 的临时 .mjs 副本)        OK
node --check tests/auto-e1.selftest.mjs               OK
node tests/auto-e1.selftest.mjs
SELFTEST PASS 480/480 assertions | ops=9 | coverage 38 (9 implemented / 22 mapped / 7 blocked)

import("./ops/auto-e1.js")
OPS=9  COVERAGE=38  byStatus={implemented:9,mapped:22,blocked:7}

插件 mock 装载（index.js setup）
registered=396（本次快照，含工作区其他批次）  e1 ops=9  duplicate ids=0
（E1 贡献 9；总数随其他批次并发变化）

主件目标核对
878 main op ids  →  22/22 mapped target 存在；e1 op id 无碰撞

Webdings
ASCII 32-126 + Latin-1 128-255：223/223 槽往返，223 个符号唯一
```

覆盖不变量：

- 38 条全部为 `implemented | mapped | blocked`。
- 9 条 implemented 全部指向本文件存在的 `dcode-extras-2026-10/e1-*` op。
- 9 个 op 全部至少覆盖一个工具，无孤立 op。
- mapped 全部有非空 `target`；blocked 全部有非空 `reason`。
- 所有 op id 的本地 slug 以 `e1-` 开头。

## 8. 已知近似与边界

- 地理计算使用球面模型（默认 R=6371 km），不是 WGS84 椭球；dCode 可能用不同半径/四舍五入，因此输出按“同公式、同半径”对拍，不承诺逐字符一致。
- `distance-geographique` 与 `distance-haversine` 是 dCode 两个不同页面：前者是地址/道路距离，后者是球面大圆；本轮只实现后者，前者 blocked。
- 法国省份表含 101 个正式省 + 8 个海外集体（975/977/978/984/986/987/988/989），集体在输出第三列标 `collectivité`；`Réunion` 用 `La Réunion` 名称并带 `reunion` 别名。
- `e1-cesar-progressif` 覆盖逐字符/逐词/每 N 字符与初始位移；dCode UI 的 “Commencer à 0” 对应 `start=0`。默认 `start=1, step=1` 即 1,2,3…。
- `e1-mult-vigenere` decode 要求密文逐项被密钥整除；dCode 的“自动找密钥/GCD”未实现，避免给出不唯一答案。
- `e1-webdings` 覆盖 ASCII + Latin-1（223 槽），不含 Unicode 扩展区/emoji 输入；未知符号显式报错。
- mapped 目标依赖主件现有 id；主件后续改名/删除时需同步 `COVERAGE[].target`。

## 9. 未完成声明

本轮只对任务书指定的 37 个缺失 slug + 1 个 D1 Webdings 回收负责，不代表 dCode 1308 工具全站完成。7 条 blocked 已逐条给出具体原因；22 条 mapped 已核对主件 878 op 注册表；8 个 assigned implemented op 均有已知向量/往返/异常面测试。
