# Agent D3 · dCode 分类全量覆盖批（Jeux / Fun / Nombres / Société / Mobile / Recherche / Musique / Date / Télécom / Internet / Texte）

- 日期：2026-10-30
- 范围：dCode 11 个分类、**264 个工具条目**（源：`资料/工程留存/T508/dcode_tools.txt`）
- 产出：**42 个新 op**（id 全部 `d3-*`）+ **264 条逐条 COVERAGE 台账**
- 结论：**implemented 127 条 / mapped 96 条 / blocked 41 条**；无条目被静默丢弃

## 0. 口径

| 状态 | 含义 |
|---|---|
| `implemented` | 本批 `auto-d3.js` 的新 op 直接实现确定性核心；已知向量/往返在 `auto-d3.selftest.mjs` |
| `mapped` | 本插件既有 op / 主程序 op 已覆盖，或新 d3 op 仅覆盖确定性核心而专有数据缺失；括注里写明局限（如仅字母架、仅组合枚举、仅解析） |
| `blocked` | 需要图片/OCR/音频/外部 DNS/运营商库/专有规则库，或规范未公开；不伪造结果 |

264 个条目对应 **220 个唯一 URL**（Boggle、Taquin、Scrabble、Word Cookies 等跨分类重复出现）；计数按条目口径，与 dCode 分类清单一致。

## 1. 分类计数

| 分类 | 条目 | implemented | mapped | blocked |
|---|---:|---:|---:|---:|
| Jeux de Société | 22 | 11 | 10 | 1 |
| Jeux sur Mobile | 13 | 6 | 5 | 2 |
| Jeux de Lettres | 69 | 45 | 16 | 8 |
| Jeux de Nombres | 40 | 15 | 18 | 7 |
| Recherche de Mots | 15 | 9 | 5 | 1 |
| Internet | 12 | 3 | 8 | 1 |
| Télécommunication | 11 | 1 | 9 | 1 |
| Traitement de Texte | 7 | 4 | 3 | 0 |
| Fun/Divers | 59 | 24 | 19 | 16 |
| Date et Temps | 10 | 8 | 2 | 0 |
| Musique | 6 | 1 | 1 | 4 |
| **合计** | **264** | **127** | **96** | **41** |

逐条记录在 `ops/auto-d3.js` 的 `export const COVERAGE`：每条含 `cat / name / slug / url / status / op|reason`。selftest 会断言 264 条、127/96/41、每分类计数、URL 前缀、无内部台账缺口。

## 2. 新增 42 op

### 词类 / 棋盘（19）
`d3-boggle`（4×4/5×5/6×6/n×n 路径搜词）、`d3-wordfind`（字母架找词）、`d3-spellingbee`（Spelling Bee/Blossom）、`d3-letterboxed`、`d3-wordextend`（加/删/改/延长）、`d3-anacyclic`、`d3-wordpyramid`、`d3-missingletters`（缺元音/辅音）、`d3-wordregex`（通配/正则）、`d3-wordorder`（前词/后词）、`d3-jotto`、`d3-motus`（Motus/Sutom/Tusmo）、`d3-phrasefilter`（轮盘/短语）、`d3-wordsearch`（找词网格）、`d3-anagram-gen`、`d3-palindrome-gen`、`d3-card`（52 张牌名称/人物/缩写/Unicode）、`d3-mastermind`、`d3-chess`（FEN/UCI/SAN 解析）。

### 数字 / 逻辑（8）
`d3-magicsquare`（奇数/单偶数/双偶数幻方 + 校验）、`d3-countdown`（Le Compte Est Bon/24 点/Mathador/Krypto/All Ten）、`d3-sudoku-n`（8×8/10×10/16×16/Wordoku，含校验）、`d3-calcspell`（BEGHILOS/TI-30）、`d3-constants`（π/τ/e/φ BigInt 小数 + 数字检索）、`d3-birthday`、`d3-zodiac`（西方星座/中国生肖）、`d3-holecalc`（计算填空：数字/运算符）。

### 文本 / 日期 / 通信 / 杂项（15）
`d3-random`（字母/数字/数/词/牌/抽签/假名）、`d3-date`（星期/差值/加/年内第几天/世纪/多格式）、`d3-latin-date`（Kalendae/Nonae/Idus 包含计数）、`d3-timedilation`、`d3-ami`（AMI 交替传导反转）、`d3-midi`（MIDI 文件提取/音名/频率/solfège）、`d3-chartype`（字符类/文字系统/特殊字符）、`d3-readability`（Flesch/FK/Fog/SMOG/ARI/Coleman-Liau）、`d3-strings`（可打印 ASCII 提取）、`d3-fakeid`（虚构身份/假名）、`d3-passvariants`（密码变体）、`d3-homoglyph`（西里尔同形字，可逆）、`d3-maze`（DFS perfect maze）、`d3-portmanteau`、`d3-life`（Conway 生命游戏）。

## 3. blocked 41 条（38 个唯一工具）

| 工具（slug） | 原因 |
|---|---|
| Solveur Fling (`solveur-fling`) | 专有弹球谜题，规则/盘面格式未公开 |
| Solveur AlphaBetty (`solveur-alphabetty`) | 专有六边形词盘与内置词典规则未公开 |
| Solveur de Codycross (`solveur-codycross`) | 填字线索数据库不公开 |
| Alphamo (`solveur-alphamo`) | 专有词盘机制未公开 |
| Générateur d'Autogramme (`generateur-auto-description`) | 自描述句需受约束自然语言搜索，无公开确定性算法 |
| Harry - Le Jeu (`harry-jeu`) | 专有游戏规则/棋盘未公开 |
| Solveur Figguess (`solveur-figguess`) | 图片线索语义库缺失 |
| Solveur de Mots-Croisés (`solveur-mots-croises`) | 填字线索数据库不公开 |
| Solveur de Mots Couplés (`solveur-mots-couples`) | 专有配对词游戏规则未公开 |
| Solveur Fill-A-Pix (`solveur-fill-a-pix`) | 马赛克线索求解需完整盘面格式，未实现 |
| Solveur Picture Sweep (`solveur-picture-sweep`) | 专有图片扫雷玩法，规则/盘面格式未公开 |
| Solveur Sudoku 5x5 (`solveur-sudoku-5x5`) | 无标准 5×5 宫格划分，变体规则未文档化 |
| Solveur Sudoku 7x7 (`solveur-sudoku-7x7`) | 无标准 7×7 宫格划分 |
| Solveur Sudoku NxN Irrégulier (`solveur-sudoku-irregulier`) | 不规则宫需区域映射输入，格式未文档化 |
| Solveur Tectonic (`solveur-tectonic`) | 区域逻辑谜题求解器未实现 |
| Clé de Transposition (`cle-transposition`) | 换位密钥恢复需完整密码分析器，未实现 |
| Enregistrements DNS (`enregistrements-dns`) | 需 DNS 网络查询，违反纯前端零外发 |
| Géolocalisation d'un Numéro de Téléphone (`geolocalisation-numero-telephone`) | 需运营商/号码段数据库或外部 API |
| Accent Allemand (`accent-allemand`) | dCode 专有谐音改写规则未公开，规则近似会伪造结果 |
| Accent Anglais (`accent-anglais`) | 同上 |
| Accent Asiatique (`accent-asiatique`) | 同上 |
| Accent Espagnol (`accent-hispanique`) | 同上 |
| Accent Etranger (`accent-etranger`) | 同上 |
| Accent Français (`accent-francais`) | 同上 |
| Accent Italien (`accent-italien`) | 同上 |
| Accent Russe (`accent-russe`) | 同上 |
| Caractères des Alphabets Etrangers (`alphabets-caracteres-latins-etrangers`) | 外语字母参考/输入表，非确定性算法 |
| Carte d'Identité Européenne (`carte-identite-europenne`) | 身份证件/MRZ 版式与校验规则依发行国而异，缺数据 |
| Carte d'Identité Française (`carte-identite-francaise`) | 法国身份证号码/版式校验规则未内置 |
| Chiffres Miroir (`chiffres-miroir`) | 镜像数字为图形符号，无标准 Unicode 映射 |
| Ecriture Dotsies (`ecriture-dotsies`) | Dotsies 点阵字体映射非 Unicode 标准，未内置 |
| Langage de Shankar (Slumdog Millionnaire) (`langage-shankar`) | 虚构语言映射未公开 |
| Rotation du Cube (`rotation-cube`) | 三维魔方状态旋转，输入格式/规则未文档化 |
| Séparateur de Syllabes (`separateur-syllabes`) | 音节切分需语言词典/专门算法，规则近似不可靠 |
| Chiffre par Partition Musicale (`chiffre-partition-musicale`) | 乐谱图形/音符映射未文档化 |
| Code Acéré (`chiffre-acere`) | 冷门符号密码，无公开规范 |
| Notation des Accords de Guitare (`notation-accords-guitare`) | 和弦指法图数据库缺失 |
| Partition/Portée de Musique (`partition-musique`) | 五线谱渲染需图形/字体引擎 |

> 其中 `Solveur AlphaBetty`、`Solveur de Codycross`、`Générateur d'Autogramme` 各跨两个分类出现，所以 38 个唯一工具对应 41 个条目。

## 4. mapped 96 条的处理

- **本插件既有 op**：`game-taquin`（Taquin 4 条）、`game-hanoi`、`game-lightsout`、`game-bullscows`、`game-cryptarithm`、`game-kakuro`、`game-takuzu`（Takuzu/Binairo/Binoxxo）、`game-latin`、`game-sudoku`（4/6/9/12）、`game-set`、`lex-scrabble`（Scrabble/Wordfeud/Aworded/Popotamo/Wordox/Mots entre Amis）、`lex-ladder`、`lex-longest`、`lex-search`、`lex-pendu`、`lex-isogram`、`lex-anagram`、`lex-wordle`、`txt-mixletters`、`txt-mixwords`、`txt-case`、`txt-accents`、`txt-count`、`txt-reverse`、`txt-updown`、`txt-typoglycemia`、`txt-draw`、`math-digitsum`、`math-wordvalue`（4 种数秘）、`math-lychrel`、`math-lookandsay`、`math-sydney`、`num-bibi`、`num-shadok`、`num-domino`、`math-*` 其余。
- **主程序 op**：`base64`、`url`、`htmlEntity`、`unicodeEscape`、`rot47`、`ipv4Int` / `ipv6Format`、`color` / `colorInfo`、`morse`、`baudot`、`dtmf`、`decabit`、`manchester`、`t9Phone`、`multitap`、`wabun`、`leetSpeak`、`mirrorLetters`、`unixTime`、`filetime`。
- **带局限的 mapped**（已在 `COVERAGE.op` 括号注明）：
  - Pixwords / 4 Images 1 Mot / Quel Est le Mot / Wordalot → `d3-wordfind` 仅覆盖字母架，图片线索库未提供；
  - Kakuro → `game-kakuro` 仅组合枚举，整盘求解未实现；
  - Addition de Mots → dCode 该页是入口页，分别指向变位词/字谜算式/单词数值；
  - Notes de Musique → `d3-midi` 只覆盖英语/法语 + MIDI/频率；印度 svara、德国 H、日本 Iroha、中国工尺、阿拉伯记谱转换未覆盖。
  - Notes Midi → `d3-midi` 的 `file` 模式解析标准 MIDI 文件（MThd/MTrk、VLQ、running status、Note On/Off、tempo map），覆盖文件音符提取；不含音频渲染。

## 5. 测试与验证

```text
node --check addons/dcode-extras-2026-10/ops/auto-d3.js
# exit 0

node addons/dcode-extras-2026-10/tests/auto-d3.selftest.mjs
# AUTO-D3 SELFTEST PASS 1696/1696 assertions
```

selftest 覆盖：
- 42 个 op 的已知向量/往返/结构断言（Boggle 词、Wordle/Motus 反馈、幻方和、24 点、数独 16/10/4、BEGHILOS/TI-30、π/e/φ/τ、生日、星座、拉丁日期、AMI、FEN/UCI/SAN、MIDI 文件/音名、同形字往返、迷宫结构、生命游戏、计算填空等）；
- 台账结构：264 条、127/96/41、11 个分类的逐类计数、URL 前缀、implemented 指向的 op 均存在、无“台账缺失”内部缺口；
- 外部集成：用 mock ctx 走 `index.js` 动态加载，本批 42 个 `d3-*` 全部注册、id 无重复（测试时插件总注册数随其他 Agent 批次变化，不作为固定断言）。

## 6. 明确限制（不冒充完整 dCode）

- 词类 op 使用插件内置 EN/FR 词典或输入中 `===` 后自带词表；dCode 各游戏的私有词库/每日答案库不捆绑，**不内置谜题答案**。
- `d3-chess` 只做 FEN/UCI/SAN 记谱解析，不校验走法合法性、不生成合法着法。
- `d3-boggle` 用于 Squaredle/Word Hunt 等路径游戏时只负责“路径可拼词”，不强制各游戏“找齐全部词/用完全部字母”的目标提示。
- `d3-phrasefilter`（Roue de la Fortune / What's the Phrase）不内置影视/节目短语库，候选短语需由用户在 `===` 后提供。
- `d3-card` 是法式 52 张牌参考（含传统人物名），不含塔罗、 joker、各地区变体牌序。
- `d3-calcspell` 的 BEGHILOS 仅支持 BEGHILOSZ 字母；TI-30 解码多对一，输出歧义集合。
- `d3-readability` 的音节数为规则启发式，不是词典音节切分；用于相对比较。
- `d3-constants` 最多 500 位小数；`d3-countdown` 默认 30 万节点；`d3-boggle` 200 万路径节点；`d3-sudoku-n` 300 万节点；超限显式报错。
- `d3-maze`、`d3-random`、`d3-fakeid` 使用统一随机源（`src/core/randSource.js`），输出非确定；测试只断言结构/范围。
- 拉丁日期按古典罗马历（Kalendae/Nonae/Idus + 包含计数）实现，不处理罗马历改历/闰年历史争议。

## 7. 文件

| 文件 | 说明 |
|---|---|
| `addons/dcode-extras-2026-10/ops/auto-d3.js` | 42 个 `d3-*` op + `export const OPS` + `export const COVERAGE`（264 条逐条台账） |
| `addons/dcode-extras-2026-10/tests/auto-d3.selftest.mjs` | 1696 条断言；覆盖全部 42 op 与台账结构 |
| `addons/dcode-extras-2026-10/report-d3.md` | 本报告 |

未修改 `index.js`、`official.json`、既有 `ops/`、`tests/`、`README`、`src/**`、`library`、`stage`；未 commit/push。
