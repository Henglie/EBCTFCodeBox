// Authored bilingual chapters. References are checked source locations, not a declaration of certification.
export const revision = "2026-11-14";
export const chapters = {
  zh: [
    { id: "install", title: "1　全部系统快速安装与启动", body: `
## 1.1 先分清两个 HTML
本手册可以直接双击；工具箱应用使用原生 ES module 和可选 WASM，不能把应用的 index.html 当普通本地网页双击运行。先解压完整发行包，再用包内启动入口打开本地 HTTP 页面。不要只从压缩包预览窗口运行一个 exe，也不要把 src、public、addons 当作可删附件。

本书适用于构建页脚标明的运行版本。平台可用性、独立窗口及安装包以实际发行件为准，不把浏览器页面等同于原生应用。内置功能、官方扩展与外部运行时是三件事：扩展默认未启用；Python/Java/外部 exe 所需能力按工具具体条目检查。

## 1.2 Windows
解压到当前用户可写目录，保留完整目录结构，双击 Start-Windows.exe。浏览器打开后先用 Base64 解码 Zm9v，应得到 foo。若包中附有新的独立窗口入口，按该包启动说明使用；本书不凭文件名承诺其已经发行或免除 WebView 运行时要求。

没有对应原生启动器时，可在完整源码目录运行 py start.py；也可使用已有 Python 的 python start.py。这里的 Python 命令取决于本机安装方式，不保证每台机器都有 py。不要为了普通文本编码先安装所有外部工具。需要桥接的工具会明确标注，缺桥时不能把界面能打开当成功执行。

GIF 拍摄位 INSTALL-WIN：完整解压→启动→首次 Base64 成功→关闭；不要录入个人目录和真实授权对象。

## 1.3 macOS
保留 Start-macOS.command 与 bin/launcher-macos 的相对位置。终端进入解压目录，必要时执行 chmod +x Start-macOS.command bin/launcher-macos，再运行 ./Start-macOS.command。Finder 的首次打开行为由系统安全策略和发行签名状态决定；查看系统给出的来源信息，不把未公证产物描述成已公证。

替代入口为 python3 start.py（须本机已有 Python）。Apple Silicon 与 Intel 的实际可运行结论需对应机器验收，交叉编译文件存在不等于已真机运行。GIF INSTALL-MAC 待两种架构各一次实际启动记录。

## 1.4 Linux
保留 Start-Linux.sh 与 bin/launcher-linux；按需 chmod +x Start-Linux.sh bin/launcher-linux，运行 ./Start-Linux.sh。文件管理器是否允许双击脚本取决于桌面设置；终端执行不依赖该选项。缺匹配架构/动态加载器时，使用本机已有 Python 的 python3 start.py。不要把一个 x86-64 二进制称作所有发行版与架构都兼容。GIF INSTALL-LINUX 记录发行版、架构、浏览器和首次转换。

## 1.5 Android、iOS/iPadOS、ChromeOS
Android 用现代浏览器访问已经部署的 HTTP(S) 应用；浏览器提供安装/添加主屏幕时可安装 PWA。iPhone/iPad 使用 Safari 分享菜单的「添加到主屏幕」。ChromeOS 可使用 Chrome 网站/PWA；Linux 容器中自行起服务是另一路径，不要求先启用容器。

PWA 的离线能力取决于实际已缓存的资源：首次访问和按需语言/OCR/WASM 包未下载时不能假定全量离线。先联网打开要用的页面和资源，再关闭网络并重载验证；更新需要分别检查旧缓存与新版激活。iOS 的存储回收、浏览器后台限制和系统文件选择行为与桌面不同。移动端没有 Windows 外部 exe 桥，不能从「同一界面」推导成「同一外部能力」。GIF INSTALL-ANDROID / INSTALL-IOS / INSTALL-CHROMEOS 待真人设备操作。

## 1.6 鸿蒙
把浏览器访问与纯血鸿蒙原生应用分开记录。支持的浏览器可访问部署站点；是否能安装 PWA、文件选择与 WASM 行为须按系统/API/浏览器版本实测。本冻结版本不据工程目录或环境存在宣称原生安装包已完成、已签名或已满足赛事原生规则。GIF INSTALL-HARMONY 须附真实设备型号、系统、浏览器/原生包版本及安装路径，待对应产物就绪拍摄。

## 1.7 第一次成功、离线与排错
首次成功只做一个可核对动作：Base64 解码 Zm9v→foo。再试拖入一份自己制作的小文件，确认报告、下载和取消。普通文本成功不能证明图片、OCR、外部桥都可用。若模块加载失败，检查是否从完整 HTTP 站点启动以及请求状态；若多线程 WASM 不可用，检查部署是否提供跨源隔离所需 COOP/COEP，而不是修改密文凑结果。

本地处理不等于所有操作永不联网：手动外链、更新、资源准备、用户配置的 AI endpoint、环境包安装属于独立边界。密码、真实私钥和个人材料不要放进演示截图。局域网提供服务时要单独核监听/访问控制，不能把回环本地入口说明套用到公网部署。
` },
    { id: "workflow", title: "2　一把梭与配方：先得到线索，再验证", body: `
## 2.1 一把梭的可验证起手式
在首页粘贴 Zm9v，触发一键解码，找到 Base64→foo。候选分数是启发式排序，不是统计意义上的正确概率；可读字符串也不是密码学认证。没有结果时先检查输入是否其实是文件字节、十六进制展示、Base64 文本或已被转义的字符串，别先把强度推到顶。

解码强度控制搜索范围与工作量；参与算法、层数、爆破候选等设置不是「通用解密钥匙」。先低强度、看中间结果，再针对已知结构扩大一项。宽松模式容忍更弱的结构，假阳性随之上升。目标特征只用于查找/筛选，不应把符合 flag 样式当作独立真实性证明。处理用户正则时先从短输入和简单模式开始。

文件应通过拖入/选择进入文件通道。文本框中的 89 50 4E 47 是字符，只有显式解释为 hex 后才是 PNG 头字节。文本/hex/Base64/转义字节视图的切换改变表示方式，不应悄悄改变原始字节；字符集解释与编码算法也要分清。当前音频文件分析范围位于解码强度的文件页：0 表示全量，非零按分钟限制分析窗口；不据此承诺支持所有音频格式解码。

## 2.2 一个两步配方
从 %5A%6D%39%76 开始：第一步 URL 解码得到 Zm9v，第二步 Base64 解码得到 foo。每一步均使用其解码方向与默认字母表。先单步核对中间值，再运行整条链；该例是人工构造的教学数据，不冒称赛事真题。书中验证记录分别检查每步和合成结果，不以「来回能还原」替代外部定义。

配方保存步骤、方向、参数与顺序。参数不同就是不同配方；把解码改成编码并不能保证逆转整条链（哈希、归一化、筛选、压缩报告等不可逆）。分叉用于让同一输入进入不同假设，合并前应说明是连接文本还是合并结构；先看单步输出，再看最终输出。遇多文件产物时，不能把报告文本、ZIP 列表与真实文件内容混为同一条字节管道。

## 2.3 保存、复用与取消
导出配方前用非敏感小样本核对；导入只恢复配置，不应执行其中的脚本或把外来代码当可信算法。收藏用于快速找到工具，历史/草稿用于恢复工作；它们不是团队共享的密钥保险柜。取消后检查结果属于哪一次输入，参数改变后的旧输出只作旧结果阅读。

一把梭帮你提出假设，独立格式校验、MAC/签名、明确题面约束才帮助你排除假设。做题可以快，结论要慢半拍。
` },
    { id: "tour", title: "3　按上下左右导览：常用到不常用", body: `
## 3.1 上方：先认当前环境
顶栏显示品牌/版本及搜索、设置等入口。授权可以覆盖应用内软件名与图标；源码版没有渠道授权时显示内置品牌，不据自定义名字推导算法变更。记录复现时至少写版本、opId、方向、参数、输入格式。

全局搜索先搜 Base64、URL 或 opId。环境/本机工具页用于了解运行时与外部能力，不要在题目尚未需要时批量安装依赖。主题、字体、动效和语言用于阅读与操作舒适度；语言切换不改变密码学参数的实际取值。圈注图 TOUR-TOP 要圈版本、搜索、环境与语言，文字编号与本节对应。

## 3.2 左方：从分类到具体工具
先看 Base、文本、哈希等常用分类，再进入古典/现代密码、文件与隐写。选中分类不等于已选算法；同族的多个档位要核方向与参数。StegSolve 固定在文件隐写的高频位置，普通算法的选中状态不代表排序改变。收藏与折叠节省寻找时间，不能用收藏数量代替功能覆盖。

官方 dCode 扩展默认不启用。启用后出现额外分类；主功能数量与扩展数量分别记录。站点工具覆盖映射中的 implemented/mapped/blocked 不是三个可直接相加的注册 op 数。本书条目按实际加载的 1 个 op 对象记账。圈注图 TOUR-LEFT 展示一个展开分类、算法族、收藏和扩展开关位置，待最终界面稳定后拍。

## 3.3 中左参数、中右输入输出
桌面普通工具使用参数区与输入/输出工作区；窄屏按可用宽度堆叠，不能把固定左右方位写成手机也相同。选一个 Base64 小例：确认解码方向，输入 Zm9v，参数保持标准字母表，输出 foo；再开启 URL-safe 或关闭 padding 比较编码行为。只改一项，才看得清差异。

哈希是单向计算：SHA-256 输入 abc，对照本书已验证摘要。不要在 Base64 和 SHA-256 都出现「编码样式字符串」时混淆编码与摘要。带 key/IV 的工具必须记录字节长度与编码，hex 的 32 个字符通常表示16字节，而不是32字节；具体字段以该条目为准。

多输入工具的 fields 与参数可能随版本调整；本书从当前 schema 输出字段，不把旧「输入B参数」截图当新界面的证据。文件输入使用原字节；输出的 text 是报告，files 是产物。图片预览并非全量文件下载，超预算仍走下载；小图能预览不说明任意尺寸都能内联。

## 3.4 下方与较少用的页面
科普卡解释原理、用法与案例；卡中示意例不一定已对当前版本逐条重跑。本书把继承例与本轮实跑分开。权威源码/编辑器用于查看实现与受控实验；改过的代码不再是默认实现的同一证据，先用合成小样本测试，再保存。

编码图鉴帮助按形状识别，不能只凭相似字形唯一判定变体。快速换算用于核字节、数值和字符表示；穷举/分析页用于已知假设下的有限搜索；图像/音频/流量页需要对应真实文件。MCP/CLI 复用算法入口，但浏览器文件API、WASM/桥、超时/产物传递各有运行条件，不能由同一opId推导所有宿主表现相同。圈注图 TOUR-WORKBENCH / TOUR-COLLECTION 用代表页各一张即可，大多数 op 不放截图。
` },
    { id: "reference", title: "4　逐 op 参考：输入、输出、参数与证据", body: `
本章后附全部冻结注册条目，包括官方 dCode 扩展。名称、方向、fields、默认值和选项来自当前模块实际加载结果；中英科普取实际聚合层。参数 schema 没声明单位、上下界或实现细节时明确列为缺口，不从变量名臆测。

每条分为：定位/原理、输入输出契约、参数/字段表、操作解释、限制、标准或实现来源、例子与内容状态。继承的科普内容是参考底稿，不自动升级为逐项权威审校；示意输入如 c=...、一张图片、(hex ciphertext) 标为未实跑。已实跑例注明字节、方向、覆盖的参数和独立判据。完整缺口随 catalog.json 留存，也在条目中可读。

单向工具只有 run 时，不制造「解码」。双向工具不保证对所有输入一一可逆：大小写归一化、非法字符处理、字符集与随机封装都影响互通。文件类必须分清二进制输出与文本报告；无主输入框也不表示无输入，参数/fields/图像专页仍可消费数据。
` },
    { id: "collections", title: "5　集合工具逐子功能操作", body: `
## 5.1 StegSolve：先看图，再提取
打开真实图片。主图变换与帧浏览是两条轴：通道/位平面变换用于查看像素位，帧浏览用于查看动画的不同合成帧。42 变换表从当前核心枚举生成，附在本章。原图、反色、A/R/G/B 各8位、完整通道、随机映射和灰度位不是42种解密算法。随机颜色用于突出相同值结构，不是增强随机源，也不是找到了载荷。

数据提取：选择 R/G/B/A 的位，指定按行/按列、通道排列和 MSB-first/LSB-first。bit0 是最低有效位；「选哪个位」与「把所选位如何组装成字节」是两种顺序。先用 LSB B0 快选做最小试验，再按题面改变一项。预览只显示前64 KiB，保存 Bin用于完整原字节；保存文本是格式化预览，不能冒充同一二进制文件。本书8像素教学例按 B0、MSB、行扫描提取 0x41（A），属于合成例，不是真题。

帧浏览：上一帧/下一帧查看原始合成帧并保存当前帧 PNG。通道总览的42张变换基于首帧，帧总览另列动画帧；不要把首帧的变换结论套到其他帧。总览点击缩略图定位当前视图；放大、关闭、返回需保留所选帧/通道。

图像合并：选择第二张图，按 XOR/OR/AND、加减乘、逐通道明暗或水平/垂直交织操作。尺寸不同按最大宽高补0；交织会扩展画布。算术运算应看具体核心实现的截断/逐通道口径，不等价于文件字节异或。CryptoHack 的 Lemur XOR 明确要求解码图像后对 RGB像素 XOR，适合本页示范；下载附件与人工图解待清单处理。

立体图：offset 单位为像素，范围0至宽度减1；输出是原图与横向偏移图异或，不是普适三维重建。先小步改变偏移，出现轮廓后保存结果。文件格式：生成PNG/GIF/JPEG/BMP结构与尾部数据报告，查看明确的结构字段；没有报告项不等于证明没有隐写。

批量导出：ZIP含动画帧、首帧42通道与manifest，受256 MiB预算约束；本机浏览器压缩能力不同会影响体积。先用小文件确认，错误/取消不能记作完整交付。保留原文件，不用截图代替位平面原数据。

## 5.2 一把梭与穷举
识别、有限候选解码、层级搜索、评分与特征筛选分别回答不同问题。识别指纹不是数学证明，候选可读不等于唯一。参数密钥池只在声明参与的工具生效，不能据通用key框推导所有非对称算法都会自动爆破。固定输入、池、层数与强度再比较结果；例外与预算触发要写进复现记录。

## 5.3 配方、批处理与产物
配方按顺序复用步骤；逐步检查中间值，导出配置用于复现。批处理对多个输入重复操作，先单样本验证，再核队列中的失败/取消和每个产物归属。图片文字、报告、文件下载是不同结果类型。无对应文件时不能声称批处理完成，ZIP打开成功也不能证明内容来自正确输入。

## 5.4 编码图鉴、文件分析、快速换算与本机工具
图鉴：识别/裁剪/浏览图表用于缩小候选，回到具体op核变体。文件分析：先嗅探格式和结构，再看尾部、元数据与针对性动作；加密流量摘要不等于TLS解密。快速换算：确认有符号/无符号和进制位宽；十六进制显示不是字符集。环境页：版本探测、复制安装命令、用户触发安装属于不同动作；网页缺本地桥时不能把命令文本显示当安装成功。

这些页面的完整行为取决于界面与宿主；本书给可复现操作顺序和边界，核心函数小样本验证不替代真人文件选择、剪贴板、移动端和平台运行验收。
` },
    { id: "afterword", title: "6　后记：版本、来源、修订与未完成项", body: `
本书是一份带证据状态的参考版本，不是宣称所有条目均经独立密码学审计的证书。目录/参数覆盖、额外正文审校、例子实跑、真实题源核验、人工图像验收分别记账。生成器会拒绝源数据在构建中漂移，并留下输入哈希、内容快照及产物大小；重新生成后必须核对源差量，不能沿用旧例子通过数冒充新版本已测。

算法标准和实现来源分开：RFC/NIST等文档定义协议，源文件说明本工具实际参数口径；链接存在不等于文档已逐条核验。正文不自动执行从题库或科普卡拿到的代码。外部题源保持作者/平台署名，附件和截图权限由恒烈确认。

历史 Rabbit 样章与 BUUCTF线索留在编辑源中，用于追溯而非自动宣告当前正确；当前 Rabbit 参数已经增加模式/编码选项，必须以本书现用表为准。本书引用了安全的数学排版，浏览器无MathML能力时仍保留可读公式文本；禁用脚本时正文与目录仍存在，搜索可用浏览器自带查找。

修订顺序：核冻结清单→逐参数补单位/校验与前提→补独立向量→真人截图/真题解析→非作者审校→发行包验收。允许写得有趣，但不允许让一个笑话替你证明一个密码。
` }
  ],
  en: [
    { id: "install", title: "1　Quick start on every supported system", body: `
## 1.1 Two different HTML files
This manual opens by double-clicking. The application uses native ES modules and optional WASM; opening its index.html through file:// is not the supported application startup path. Extract the complete distribution and use its launcher to open a local HTTP page. Keep src, public and addons in place; launching one executable from an archive preview is not a complete installation.

The footer identifies the runtime version of this snapshot. A browser client is not a native application. Built-in operations, the optional official extension and external runtimes are separate capabilities. Do not infer an available executable, signing status or a platform test from the existence of a project directory.

## 1.2 Windows
Extract into a writable folder and open Start-Windows.exe. Decode Zm9v with Base64 and check for foo before installing optional tools. If a later package includes a standalone-window launcher, follow that package's instructions; this reference does not promise that it has already shipped or that WebView requirements disappear.

With an existing Python installation, py start.py or python start.py is an alternative; the command depends on the local installation. A visible bridge-dependent page does not prove that its external tool can run. GIF slot INSTALL-WIN: extraction, startup, the first verified conversion, and close; exclude personal paths and license subjects.

## 1.3 macOS
Keep Start-macOS.command beside bin/launcher-macos. In the extracted directory, use chmod +x Start-macOS.command bin/launcher-macos if needed, then ./Start-macOS.command. First-open behavior depends on system policy and the actual signing/notarization state. A cross-compiled file is not evidence of execution on Intel or Apple Silicon. An existing Python installation can run python3 start.py. INSTALL-MAC awaits real startup recordings for the relevant architectures.

## 1.4 Linux
Keep Start-Linux.sh and bin/launcher-linux together. If needed, run chmod +x Start-Linux.sh bin/launcher-linux, then ./Start-Linux.sh. File-manager script execution is desktop-dependent; the terminal route does not depend on that option. If architecture or loader requirements do not match, use python3 start.py with an already installed Python. One x86-64 binary does not cover every distribution and architecture. INSTALL-LINUX must record distribution, architecture, browser and the first conversion.

## 1.5 Android, iOS/iPadOS and ChromeOS
Open a deployed HTTP(S) application in a modern browser. Android and ChromeOS can install a PWA when the browser offers it. On iOS/iPadOS, Safari's Share menu offers Add to Home Screen. A ChromeOS Linux container is an optional hosting route, not a prerequisite for the website.

Offline availability depends on resources actually cached. First visits and optional language/OCR/WASM packages cannot be assumed offline-ready. Open the required pages/resources while connected, disconnect, then reload and verify. Upgrade activation is a separate test. Mobile storage eviction, background execution and file pickers differ from desktop behavior; Windows executable bridges do not become mobile capabilities merely because the page looks identical. INSTALL-ANDROID, INSTALL-IOS and INSTALL-CHROMEOS await device recordings.

## 1.6 HarmonyOS
Separate browser access from a native HarmonyOS application. Test PWA installation, file access and WASM against the exact OS/API/browser. This snapshot does not claim a signed native package or competition-native compliance simply because an engineering environment exists. INSTALL-HARMONY needs a real device, OS/browser or native package version, and the actual installation route once the corresponding artifact is ready.

## 1.7 First success, offline checks and diagnosis
Start with Base64 decode Zm9v→foo; then use a small synthetic file to check reporting, download and cancellation. Text success proves neither OCR nor a bridge. Module errors require a complete HTTP-served application and inspection of request status. Threaded WASM may require COOP/COEP isolation headers; changing the ciphertext is not a loading fix.

Local computation is distinct from explicit links, updates, resource preparation, a user-configured AI endpoint or package installation. Do not record real passwords, private keys or personal material in demonstrations. A loopback setup description must not be reused as a public-network access-control policy.
` },
    { id: "workflow", title: "2　One-shot decoding and recipes: hypotheses before conclusions", body: `
## 2.1 A checkable first step
Paste Zm9v on the home page, request decoding and inspect the Base64→foo candidate. A heuristic score is not a calibrated probability, and readable output is not authentication. Before increasing strength, decide whether the input is file bytes, hexadecimal display, Base64 text or escaped characters.

Strength changes search scope and workload. Candidate pools, depth and brute-force settings are not universal decryption keys. Begin with a small scope, inspect intermediate output, and expand one dimension at a time. Lenient parsing increases false positives. A target pattern helps locate candidates; matching a flag-shaped string is not independent proof. Keep initial regex tests short and simple.

Use the file channel for files. The characters 89 50 4E 47 are not PNG bytes until interpreted as hexadecimal. Text/hex/Base64/escaped-byte views describe representations; distinguish them from character-set decoding and algorithm transforms. Audio file-analysis duration is configured on the file tab of decoding strength: zero requests the full input, and nonzero values are minutes. This does not imply arbitrary audio-format support.

## 2.2 A two-step recipe
Start with %5A%6D%39%76. URL decoding gives Zm9v; Base64 decoding gives foo. Both steps use the decode direction and the standard alphabet. Check each intermediate value before running the entire chain. This is synthetic teaching data, not a competition challenge. The verification checks both steps and the composed result against independent definitions rather than relying on a round trip.

Recipes preserve order, direction and parameters. A different parameter means a different recipe. Reversing buttons does not invert a hash, normalization or filtering step. Branches represent parallel hypotheses; explain whether merging joins text or combines structured results. Reports, ZIP listings and real binary products are different pipeline values.

## 2.3 Reuse and cancellation
Verify exported recipes with nonsensitive small data. Importing configuration should not execute arbitrary scripts or confer trust on custom code. Favorites find tools; history and drafts recover work, not serve as a shared key vault. After cancellation or editing, check which input revision produced an output. One-shot decoding proposes hypotheses; a format check, authenticated tag, signature or explicit challenge constraint can test them.
` },
    { id: "tour", title: "3　A spatial tour, from frequent to occasional tasks", body: `
## 3.1 Above: establish the environment
The top bar identifies brand/version and provides search/settings entry points. A signed license may override the in-application name/icon; a custom name is not an algorithm change. Record version, opId, direction, parameters and input representation when reproducing results.

Search for Base64, URL or an exact opId. Environment/local-tool pages describe runtimes and optional native capabilities; do not install every dependency before knowing which task needs it. Theme, fonts, motion and language affect usability, not the stored value of cryptographic parameters. Annotated image TOUR-TOP should identify version, search, environment and language after the UI is stable.

## 3.2 Left: select a category, then an operation
Start with Base, text and hashes before classical/modern cryptography and file steganography. A category is not a selected algorithm. Family members may differ in direction and parameters. StegSolve has a fixed prominent position in file steganography; highlighting an ordinary operation is not evidence of reordering. Favorites are navigation aids, not coverage counts.

The official dCode extension is opt-in and adds categories. Keep built-in and extension counts separate. Its implemented/mapped/blocked coverage rows are not additional registered operations. This book counts actual loaded operation objects. TOUR-LEFT should show one expanded category, a family, favorites and the extension enablement route.

## 3.3 Middle: parameters and input/output
Desktop tools arrange configuration beside the work area; narrow viewports stack regions. Do not impose desktop left/right descriptions on a phone. Select Base64, choose decode, keep its standard alphabet, and turn Zm9v into foo. Change only one option when exploring URL-safe output or padding.

SHA-256 is one-way: compare abc with the independently checked digest below. Encoding and hashing do not become equivalent because both produce printable strings. A 32-character hex key usually represents 16 bytes, not 32; consult the particular parameter's convention. Input fields and legacy parameters can change between versions; the generated tables use the current schema rather than old screenshots.

File input uses bytes. The text member of a result is a report, while files holds products. Inline image previews do not replace the downloadable product and have separate budgets. TOUR-WORKBENCH needs one representative screen, not a screenshot for every operation.

## 3.4 Below and less frequent pages
Explainer cards provide background and inherited examples, not proof that every example was rerun for this version. Custom source/code editors support experiments; changed code is a different implementation and needs new evidence. Use synthetic samples before saving it.

The code-image gallery suggests symbol candidates, not a unique cipher variant. Conversion aids distinguish byte/numeric/character views. Analysis and brute-force pages test bounded hypotheses; image, audio and traffic tools need real files. MCP/CLI share algorithm entry points but host file APIs, WASM, bridges, timeout and product transfer remain environment-dependent. TOUR-COLLECTION should explain one representative collection page with numbered annotations.
` },
    { id: "reference", title: "4　Per-operation reference: inputs, outputs, parameters and evidence", body: `
All frozen registered operations follow, including the official dCode extension. Names, directions, fields, defaults and choices come from actual module loading; explainer data comes from the effective Chinese/English aggregation. Missing units, bounds or behavioral details are explicit gaps rather than guesses based on variable names.

Each entry gives purpose/principle, I/O contract, parameter/field tables, workflow explanation, limits, implementation or normative references, examples and review status. Extracted explainers are a reference draft, not a blanket claim of authoritative review. Inputs such as c=..., an image, or (hex ciphertext) remain unexecuted illustrations. Executed examples identify direction, bytes, parameters and the independent oracle. Detailed gaps are both visible and preserved in catalog.json.

Do not invent a decode direction for a run-only operation. Even two-way operations may normalize case or differ in error handling, charsets and randomized envelopes. Reports and actual binary products are not interchangeable. A hidden main input does not mean that fields, parameters or a dedicated image page consume no data.
` },
    { id: "collections", title: "5　Collection tools, subfunction by subfunction", body: `
## 5.1 StegSolve: inspect first, extract second
Open an actual image. Transform selection and frame browsing are separate axes: bit planes inspect pixel bits; frames inspect composited animation images. The current core supplies the 42-transform list below. Original, inversion, eight A/R/G/B planes each, full channels, random palettes and grayscale-bit views are not 42 decryption algorithms. Random coloring highlights repeated values; it neither improves cryptographic randomness nor proves an embedded payload.

Data extraction selects R/G/B/A bits, row/column scanning, channel permutation and MSB-first/LSB-first assembly. bit0 is the least-significant bit; choosing a plane and assembling selected bits into bytes are different orders. Start with LSB B0, then change one setting according to evidence. The preview is limited to the first64 KiB; Save Bin preserves the complete extracted bytes, whereas Save Text stores a formatted preview. The synthetic eight-pixel example below extracts 0x41 (A) using B0, MSB and row order; it is not a real challenge.

Frame Browser moves between composited source frames and saves the current frame as PNG. The 42 channel thumbnails use the first frame; the frame gallery is a separate collection. Do not generalize a first-frame observation to all frames. Thumbnails select the corresponding view; test zoom/close/return behavior on the target device.

Image Combiner accepts a second image and offers XOR/OR/AND, arithmetic, per-channel light/dark selection and horizontal/vertical interlace. Unequal dimensions are padded with zero to the maximum dimensions; interlace expands the canvas. Arithmetic truncation and per-channel behavior follow the actual implementation. Pixel XOR is not file-byte XOR. CryptoHack's Lemur XOR explicitly requires decoded RGB-pixel XOR and is a suitable real-source demonstration; attachment download and annotated solution remain on the asset list.

Stereogram offset is measured in pixels, from zero to width minus one. Output XORs the image with a horizontally shifted image; it is not universal 3D reconstruction. Step through offsets and save a useful result. File Format generates structure/trailing-data reports for the supported image formats. An absent report item is not proof of absent steganography.

Batch export packages animation frames, 42 first-frame transforms and a manifest under a 256 MiB budget. Browser compression availability changes size. Test a small file first; an error or cancellation is not a complete export. Keep the original file rather than a screenshot of its bits.

## 5.2 One-shot and exhaustive analysis
Detection, bounded candidate transforms, layered search, scoring and target filtering answer different questions. A fingerprint is not a mathematical proof and readability is not uniqueness. A generic key pool does not imply automatic attacks against every asymmetric tool. Hold input, pool, depth and strength constant when comparing results; record budget exceptions.

## 5.3 Recipes, batches and products
Check recipe intermediates and export configuration for reproduction. A batch repeats work across inputs: validate one sample, then account for each failure/cancellation and product identity. Reports, rendered images and downloaded files are separate types. A valid ZIP does not prove the contents belong to the intended input.

## 5.4 Gallery, file analysis, conversions and local tools
The code-image gallery narrows symbol candidates; verify the variant in an operation. File analysis begins with format/structure and then metadata, trailing data and targeted actions; encrypted-traffic summaries do not decrypt TLS. Numeric aids require explicit signedness and width. Environment probing, copying an install command and user-triggered installation are different actions; a displayed command without a bridge is not an installed package.

These pages depend on host/UI behavior. Core function examples support the documented small cases; they do not replace device testing of file pickers, clipboard access, runtime integration or mobile layouts.
` },
    { id: "afterword", title: "6　Afterword: versions, sources, revisions and open work", body: `
This is an evidence-labelled reference edition, not a certificate that every operation has received an independent cryptographic audit. Structural/parameter coverage, additional editorial review, executed examples, challenge-source verification and human asset review are separate measures. The generator records input hashes, a content snapshot and output sizes and rejects inputs changing during a build. Regeneration requires reviewing changes rather than carrying old pass counts into a new version.

Normative standards and implementation sources have different roles. RFC/NIST documents define protocols; source files describe this tool's actual parameter conventions. A link is not proof of a full standards review. No code copied from explainers or challenge attachments is executed during generation. Preserve platform/author attribution; challenge-attachment and screenshot rights require human confirmation.

The historical Rabbit sample and BUUCTF leads remain in editing sources for traceability, not as automatic current-version validation. Rabbit now exposes additional mode/encoding parameters; use the live tables. Safe math rendering preserves readable formula source when conversion fails. With JavaScript disabled, body text and the directory remain available and browser Find still works.

Revision order: freeze the inventory, review parameter units/checks/preconditions, add independent vectors, capture genuine demonstrations, obtain non-author review, and verify the actual distribution package. Humor may explain a cipher; it cannot prove one.
` }
  ]
};

export const opNotes = {
  base64: {
    zh: "Base64把每3字节分成4个6-bit索引；尾部padding不是加密。对任意文件应走字节输入，不能先用UTF-8解码再假定可无损编码。默认字母表由表中dict给出；URL-safe和自定义字母表都要与接收端一致。strictMode与移除非法字符是不同策略，容错会掩盖输入损坏。偏移展示是分析报告，不能当作原始Base64密文继续串联。",
    en: "Base64 groups three bytes into four six-bit indices; padding is not encryption. Use byte input for arbitrary files rather than a potentially lossy UTF-8 conversion. The table gives the actual default alphabet. Match URL-safe/custom alphabets with the receiver. Strict rejection differs from dropping non-alphabet characters, which can hide corruption. Offset display is an analysis report, not interchangeable ciphertext.",
    source: "src/core/base.js", standards: ["https://www.rfc-editor.org/rfc/rfc4648#section-4"] },
  base16: { zh: "每字节两位hex；大小写影响展示，不改变数值。decode分隔符决定如何清理文本，Auto不是严格的取证保真策略。bytesPerLine单位为字节/行，0不换行；文本显示的空格和0x前缀不属于解码后的文件。", en: "Two hex digits represent one byte. Case affects display, not value. Decode delimiters control cleanup; Auto is not strict forensic preservation. bytesPerLine counts bytes per line and zero disables wrapping. Spaces and 0x prefixes in the display are not output file bytes.", source: "src/core/base.js", standards: ["https://www.rfc-editor.org/rfc/rfc4648#section-8"] },
  url: { zh: "百分号编码作用于字节；standard采用encodeURIComponent的保留字符行为，不能笼统称所有字符都严格按RFC3986编码。full额外编码!*'()；plus把空格表示为+。表单与普通URI的+语义不同，解码模式必须随题面确认。", en: "Percent encoding operates on bytes. standard follows encodeURIComponent, not a claim that every character is encoded identically to a strict RFC3986 component. full also encodes !*'(); plus represents spaces with +. A plus sign has different meaning in form data and a generic URI component, so choose the matching mode.", source: "src/core/text.js", standards: ["https://www.rfc-editor.org/rfc/rfc3986#section-2.1"] },
  md5: { zh: "输出128-bit摘要，32个hex字符，不是可解密的密文。查表只对已知候选集合有效，找回一个相同摘要的输入也不证明唯一原文。MD5已不适合抗碰撞用途；本工具保留用于兼容与教学。", en: "The result is a128-bit digest, represented by32 hex characters, not decryptable ciphertext. Dictionary recovery tests candidates rather than proving a unique original. MD5 is unsuitable for collision-resistant security and is retained for compatibility/education.", source: "src/core/hash.js", standards: ["https://www.rfc-editor.org/rfc/rfc1321", "https://www.rfc-editor.org/rfc/rfc6151"] },
  sha1: { zh: "默认80轮对应常规SHA-1；减少轮数是分析实验，不再是标准SHA-1。摘要160bit；与文本换行、编码和文件字节有关。SHA-1碰撞安全性已失效，不能用于新签名安全设计。", en: "The default80 rounds implement conventional SHA-1; reduced rounds are an experiment, not standard SHA-1. Its digest is160bits. Encoding, newlines and file bytes matter. SHA-1 no longer provides collision resistance suitable for new signature designs.", source: "src/core/hash.js", standards: ["https://csrc.nist.gov/pubs/fips/180-4/upd1/final"] },
  sha256: { zh: "single是SHA-256；all切换为多摘要报告，不是256bit原始digest。includeNames控制报告名称。核验时输入必须是同一字节串，UTF-8的abc与hex文本616263不是同一个输入。", en: "single computes SHA-256; all produces a multi-hash report rather than one256-bit digest. includeNames controls report labels. UTF-8 abc and the literal hex text616263 are different messages unless the latter is explicitly decoded first.", source: "src/core/hash.js", standards: ["https://csrc.nist.gov/pubs/fips/180-4/upd1/final"] },
  hmac: { zh: "HMAC需要同一密钥、摘要算法和消息字节。它提供共享密钥的消息认证，不是公开签名，持有同一密钥者都能生成。key字段是本实现接受的文本口径，不能只凭看起来像hex就当二进制key；详情核hash.js。", en: "HMAC verification requires the same key, hash and message bytes. It is shared-key message authentication, not a public signature: every holder of the key can produce tags. Follow this implementation's text-key convention rather than treating a hex-looking string as raw key bytes automatically.", source: "src/core/hash.js", standards: ["https://www.rfc-editor.org/rfc/rfc2104"] },
  caesar: { zh: "standard固定位移，progInc/progDec按位置改变位移；alpha与33–126可打印ASCII环不是同一字母表。shift是环上的位置数，没有字节长度单位。不要把可读输出当唯一密钥证据。", en: "standard uses a fixed shift; progInc/progDec change it by position. The alphabetic ring differs from the printable ASCII33–126 ring. shift counts positions, not bytes. Readable output alone does not establish a unique key.", source: "src/core/fancy.js", standards: [] },
  rot13: { zh: "仅拉丁字母做13位轮转，应用两次还原；它不是保密加密。大小写和非字母透传按实现处理，不能把Unicode每个字形都当26字母环。", en: "Latin letters rotate by13 positions; applying the transform twice reverses it. This is not confidentiality protection and does not place every Unicode glyph on a26-letter ring.", source: "src/core/fancy.js", standards: [] },
  rabbit: { zh: "先选rabbitMode，再选该模式有效参数。classic的32位hex是16字节原始key，其他字符串走口令封装；空IV与8字节全零IV不是同一条件。cc模式由keyEnc/ivEnc解释字节，endianness与变体必须匹配对端。旧样章不含新增口径，不能直接当全参数说明。随机盐封装的正确性要核互通，不能要求每次密文相同。", en: "Select rabbitMode before interpreting mode-specific parameters. classic treats32 hex digits as a16-byte raw key and other strings as passphrases. An absent IV differs from an all-zero8-byte IV. cc decodes key/IV using their explicit encodings and requires matching byte order. The historical sample predates these controls. Randomly salted envelopes need interoperability checks rather than identical ciphertext on every run.", source: "src/core/streamcipher.js", standards: ["https://www.rfc-editor.org/rfc/rfc4503"] },
  pngChunkList: { zh: "先列块后导出。exportRaw默认false，selectedChunks空串表示不选块；0,3,IDAT混合索引与类型要按报告核对。产物中的原块包括长度/类型/CRC，不是单纯把IDAT拼起来就叫PNG。无PLTE时不应声称有调色板索引。", en: "List chunks before exporting. exportRaw defaults false; an empty selectedChunks selects nothing. Check mixed index/type selections such as0,3,IDAT against the report. A raw chunk includes length/type/CRC and is not a standalone PNG. An absent PLTE does not imply palette indices exist.", source: "src/core/stegoImage2.js", standards: ["https://www.w3.org/TR/png-3/"] },
  gifFrames: { zh: "maxFrames单位为帧，0要求全部，最大4096仍受像素/ZIP预算约束。首个文件是ZIP，随后可带前8帧PNG用于内联预览；未预览的帧仍应在成功导出的ZIP中核查。图像合成考虑帧处置，不能只把局部矩形当完整帧。", en: "maxFrames counts frames: zero requests all, with a4096-frame ceiling and separate pixel/ZIP budgets. The first product is the ZIP; up to eight PNG previews may follow. Validate additional frames inside the completed ZIP. Disposal/compositing matters; a local update rectangle is not necessarily a complete animation frame.", source: "src/core/stegoImage2.js", standards: ["https://www.w3.org/Graphics/GIF/spec-gif89a.txt"] },
  rsaSmallE: { zh: "输入c是整数。小e本身不是漏洞：精确整根需要m^e未跨模数，或实现允许的有限k*n+c搜索命中整幂。n留空仅适用于精确c=m^e情形。此处是无填充数学攻击前提，不据此宣称可破坏正确使用OAEP的RSA。", en: "The input c is an integer. A small public exponent alone is not a vulnerability: exact-root recovery needs an unreduced m^e, or a supported bounded search over k*n+c that finds an exact power. Omitting n only covers c=m^e. These are unpadded mathematical preconditions, not a break of correctly used RSA-OAEP.", source: "src/core/rsatool.js", standards: ["https://www.rfc-editor.org/rfc/rfc8017"] },
  stegSolve: { zh: "这是专页入口；注册表run只承接界面行为，不是把图像文件放进一个无参run就等于全套分析。各子功能的扫描/bit顺序、图像合并、帧与产物见第5章。", en: "This is a dedicated-page entry point. A run-only registry wrapper is not the complete image workflow; chapter5 documents scan/bit ordering, combination, frames and products.", source: "src/core/stegoOpWrappers.js", standards: [] },
  "dcode-extras-2026-10/math-factorial": { zh: "n字段为空时取主输入；接受非负整数，0!=1。输出位数与内存预算相关，超限要明确拒绝，不能把前若干位冒充完整阶乘。小数或负数不在该运算定义域；大结果可能通过文本文件交付。", en: "An empty n field falls back to the main input. The domain is nonnegative integers and0!=1. Large outputs are governed by digit/memory budgets and may be delivered as a text file. Rejection must not be replaced by a silently truncated factorial; fractional and negative arguments are outside this operation's domain.", source: "addons/dcode-extras-2026-10/ops/mathfun.js", standards: [] }
};

// Explicit units/semantics are based on the cited implementation; absent items remain individually tracked gaps.
export const parameterNotes = {
  "base16.bytesPerLine": ["字节/行；0不换行", "bytes/line;0 disables wrapping"],
  "sha1.rounds": ["轮；标准80，缩减轮为实验", "rounds;80 is standard, reduced rounds are experimental"],
  "url.mode": ["枚举；standard/full/plus语义见正文", "enum;standard/full/plus semantics are explained above"],
  "caesar.shift": ["字母表位置数；实现按环处理", "alphabet positions;handled modulo the selected ring"],
  "gifFrames.maxFrames": ["帧；0=全部，最大4096，另受产物预算", "frames;0=all,up to4096,also product-budget limited"],
  "pngChunkList.selectedChunks": ["块索引/类型的逗号列表；空=不导出", "comma-separated chunk indices/types;empty=no export"],
  "pngChunkList.exportRaw": ["布尔开关；开启后仍按selectedChunks选择", "boolean;selection still follows selectedChunks"],
  "rsaSmallE.e": ["整数指数，无量纲；默认3", "dimensionless integer exponent;default3"],
  "rsaSmallE.n": ["整数模数；空仅适用于精确整根条件", "integer modulus;empty only for the exact-root condition"],
  "dcode-extras-2026-10/math-factorial.n": ["非负整数，无量纲；空取主输入", "dimensionless nonnegative integer;empty uses main input"]
};

export const verifiedSources = [
  { title: "CryptoHack — Hex", url: "https://cryptohack.org/challenges/general/", challenge: "Hex", op: "base16", status: "official-page-read", shot: "真题输入hex→字节/文本；保留题名与来源，标明非普通hex文本哈希" },
  { title: "CryptoHack — Base64", url: "https://cryptohack.org/challenges/general/", challenge: "Base64", op: "base16 / base64", status: "official-page-read", shot: "原题hex先解释为字节→Base64编码，两步与中间字节圈注" },
  { title: "CryptoHack — XOR Starter", url: "https://cryptohack.org/challenges/general/", challenge: "XOR Starter", op: "xor", status: "official-page-read", shot: "label逐字节异或13；确认字段接受的key编码，拍参数与输出" },
  { title: "CryptoHack — Lemur XOR", url: "https://cryptohack.org/challenges/general/", challenge: "Lemur XOR", op: "stegSolve", status: "official-page-read-attachments-not-downloaded", shot: "下载两张原PNG，StegSolve图像合并XOR，圈注RGB像素运算与输出；人工补解析" },
  { title: "CryptoHack — Modular Exponentiation", url: "https://cryptohack.org/challenges/rsa/", challenge: "Modular Exponentiation", op: "待核当前模幂opId", status: "official-page-read", shot: "101^17 mod22663；核工具真实参数再录入，不用裸RSA签名类代替模幂" }
];
