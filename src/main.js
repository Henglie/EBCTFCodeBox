/*
 * main.js — 入口 + UI 驱动（全部由 registry 声明式渲染）。
 *
 * 职责：
 * 1. import 各算法模块（副作用注册进 OPS）。
 * 2. 按 CATEGORIES 渲染左侧导航，按 OPS 渲染分类下的功能。
 * 3. 选中一个 op → 渲染操作面板（参数表单 + 双栏 IO + 中间操作条）。
 * 4. 首页「一把梭」：对输入跑 Magic 智能识别（综合分排序 + crib 过滤 + intensive 暴力）。
 * 5. 顶栏：主题切换、检查更新（占位）、GitHub（占位）。
 *
 * 无框架、无构建，原生 ES module。状态极简：当前视图 view + 当前 op + 方向 dir。
 */
import { CATEGORIES, OPS, opsByCat, getOp, defaultParams, register } from "./core/registry.js";
import { t, tBilingual, getLocale, setLocale, locales, onLocaleChange, initLocale, getDir, LOCALE_META } from "./i18n/index.js";
import { magicDecode } from "./core/magic/magic.js";
import { runMagic, cancelMagic } from "./core/magic/magicClient.js"; // 真多线程调度（Worker 优先，降级主线程）+ 中断接管
import { analyzeFile } from "./core/fileAnalysis.js";
import { analyzeImage, analyzeImageAsync } from "./core/imageAnalysis.js";
import { analyzeAudio } from "./core/audioAnalysis.js";
import { loadLicense, OPENSOURCE_LICENSE } from "./core/license.js";
import { analyze7zFile } from "./core/sevenzip.js"; // 7z 拖入文件真列表/解压（wasm 缺失降级）
import { cryptoTryAll } from "./core/cryptoTryAll.js";
import { bridgeHealth } from "./core/localBridge.js";
import { icon as iconSvg } from "./ui/icons.js";
import { FONT_PLANES, loadFontPlane, fontStatus, onFontStatusChange, humanSize, preloadAllPlanes } from "./ui/fontLoader.js";
import { CTF_HOT, CTF_HOT_META } from "./core/ctfPresets.js";
import { getEdu, eduAliases, registerEduEn } from "./core/eduContent.js";
import EDU_IMAGES from "./core/edu/eduImages.js";
import { renderMathIn } from "./ui/katexLoader.js";
import { showLoadingScreen, setLoadingProgress, hideLoadingScreen } from "./ui/loadingScreen.js";
import { APP_VERSION } from "./core/version.js";
import { renderEnhancedView, invisibleReport, invisibleToggle } from "./ui/inputEnhance.js";
import { openEnvPanel } from "./ui/envPanel.js";
import { resolveDecodeConfig, loadLastConfig, saveLastConfig } from "./core/decodeProfile.js"; // 解码强度档 → op 白名单 + 预算
import { openDecodeStrength } from "./ui/decodeStrength.js"; // 「解码强度」弹窗（5 档滑块 + 参与算法多选 + 命名方案）
import { applyAccent, enableHctEngine, DEFAULT_ACCENT } from "./ui/dynamicColor.js"; // M3 动态取色（HSL 近似 + HCT 精确引擎）
import { attachEditorToolbar } from "./ui/editorToolbar.js"; // 通用编辑框工具条（记事本化，全站复用）
import { attachTextContextMenu } from "./ui/textContextMenu.js"; // 编辑框右键文本处理菜单
// MT72：自定义算法（魔改）——UI 开关/编辑器 + Worker 沙箱执行（magic/穷举侧排除）
import { renderCustomToggle } from "./ui/customImplEditor.js";
import { getCustomImpl, listEnabledOpIds } from "./core/customImplStore.js";
import { runCustomWithTimeout } from "./core/customImplClient.js";

// ---------- i18n 包装 ----------
// t 缺 key 时回退到 key 本身；这里再包一层：查不到就回退 registry 里的中文字面量
// 这样未翻译的 op（i18n key 表未补全的）显示原中文而非裸 key。
function catName(cat) {
  const k = "cat." + cat.id;
  const s = t(k);
  return s === k ? cat.name : s;
}
function opName(op) {
  const k = "op." + op.id + ".name";
  const s = t(k);
  return s === k ? op.name : s;
}
// 一键解码/穷举结果卡区显示 op 名用「中文 (English)」双语（便于对照）
// 但左侧菜单/op 面板标题仍走 opName 单语。双语只在结果卡渲染层用 opNameBi。
function opNameBi(op) {
  return tBilingual("op." + op.id + ".name", op.name);
}
// 暴露给独立视图模块（recipeView / exhaustiveView）复用，避免它们反向 import main.js
if (typeof window !== "undefined") {
  window.__ebctfOpName = opName;
  window.__ebctfOpNameBi = opNameBi;
  window.__ebctfT = (k, ...a) => t(k, ...a);
  window.__ebctfCatName = (id) => catNameById(id);
  window.__ebctfToast = (m) => toast(m);
}
function opDesc(op) {
  if (!op.desc) return "";
  const k = "op." + op.id + ".desc";
  const s = t(k);
  return s === k ? op.desc : s;
}

// 副作用导入：各算法模块在加载时 register 自己。新增算法模块时在此加一行。
import "./core/base.js";
import "./core/baseExt.js";
import "./core/text.js";
import "./core/textExt.js";
import "./core/fancy.js";
import "./core/fancy2.js";
import "./core/fancyExt.js";
import "./core/txtmoji.js"; // txtmoji.com emoji 加密 txtmoji（fancy, 双向, AES-256-CBC OpenSSL + 65 emoji 表 + 切固定前缀, 需密码, 逆向自 txtmoji.com）
import "./core/keyboard.js";
import "./core/classic.js";
import "./core/classicExt2.js"; // 古典密码补全组2（Trithemius）
import "./core/radix.js";
import "./core/radixExt.js";
import "./core/hash.js";
import "./core/hashExt.js";
import "./core/cn.js";
import "./core/modern.js";
import "./core/modernExt.js";
import "./core/modernExt2.js"; // 现代分组密码补全组2（RC5/IDEA/Blowfish/RC6）
import "./core/analysis.js";
import "./core/stego.js";
import "./core/lib/sjcl.js";
import "./core/stegoImage.js";
import "./core/stegoImage2.js"; // 图像隐写扩展（PNG全块/JPEG APPn/GIF注释/GIF多帧/ICC剥离）
import "./core/imagefix.js"; // 图像尺寸修复（pngSizeRecover/jpegSizeRead/gifSizeRead，替代 pngFix，更全）
import "./core/trailerCarve.js"; // 文件附加数据剥离 + binwalk 式全文魔数扫描（替代 carve）
import "./core/stegoText.js"; // 隐写文本检测组（零宽/同形字/规范化/空格/Bidi/字符透视，检测类 run 单向）
import "./core/invisibles.js"; // 不可见字符可视化（零宽/控制符/BOM/空白 → 可见占位符 + scan/visualize/strip）
import "./core/workerPool.js";
import "./core/detectExt.js"; // detect 补全扩展层
import "./core/detectExt2.js"; // detect 大表补强（82 op 补 detect，提升一把梭命中率）
import "./core/exclusiveCodec.js"; // 冷门/独有算法复刻
import "./core/token.js"; // JWT/令牌解析组
import "./core/netcodec.js"; // 网络/协议编码组
import "./core/timecodec.js"; // 时间戳/日期编码组
import "./core/checkdigit.js"; // 条码/校验位组
import "./core/morseExt.js"; // 摩斯/声光编码扩展组
import "./core/fancy3.js"; // 花式趣味编码补全组（Whitespace/Pigpen/键盘漂移/Malbolge 识别）
import "./core/compress.js"; // 压缩/归档识别组（gzip/zlib/deflate 解压 + zip/tar 结构 + magic 识别）
import "./core/hashCrack.js"; // 哈希爆破/彩虹表组（哈希类型识别 + 字典爆破 + 彩虹表 + HMAC 爆破）
import "./core/cryptanalysis.js"; // 密码分析工具组（频率分析/IC/Kasiski/卡方/单表替换求解/凯撒求位移）
import "./core/cryptanalysis2.js"; // 密码分析扩展（维吉尼亚全自动/Hill已知明文/Playfair爬山）
import "./core/cryptoTryAll.js"; // 密钥+密文一键尝试（枚举 AES/DES/3DES/RC4/XOR/Fernet × 模式 × 编码试解）
import "./core/webshell.js"; // webshell 流量解密预设（哥斯拉 PHP_XOR_BASE64 / 冰蝎 AES-ECB，固定 key 封装）
import "./core/qrcode.js"; // 二维码/条码组（QR 生成/结构解析 + Aztec/DataMatrix 识别 + 条码判定）
import "./core/qrdecode.js"; // QR 真解码组（矩阵→原文：finder/格式信息/之字形取数/掩码还原/RS 纠错/模式解码）
import "./core/keyboardExt.js"; // 键盘/布局编码补全组（QWERTY↔Dvorak↔Colemak + T9 + 多击 + 行列坐标 + Steno + 方向键）
import "./core/rsatool.js"; // 数论/RSA 攻击工具组（参数计算/小e/共模/Wiener/费马/Pollard/模逆/egcd/CRT/快速幂）
import "./core/rsatoolExt.js"; // RSA 攻击扩展（dp/dq泄露/LSB Oracle/Bleichenbacher/Coppersmith/Boneh-Durfee）
import "./core/eccdetect.js"; // 椭圆曲线/现代密码识别组（PEM/DER 结构解析 + ASN.1 TLV + EC 曲线识别 + SSH 公钥 + BTC/ETH 地址）
import "./core/charset.js"; // charset/encoding group (GBK/Big5/SJIS/EUC-KR/Latin/EBCDIC/UTF-16/QuWei/mojibake)
import "./core/signal.js"; // 数字信号编码组（曼彻斯特/差分曼彻斯特/NRZI/密勒码/4B5B/PWM-PPM 比特流互转）
import "./core/geo.js"; // GPS/地理编码组（DMS/geohash/Plus Code(OLC)/Maidenhead/UTM 双向互转）
import "./core/color.js"; // 颜色编码组（RGB↔HSL↔HSV↔CMYK↔Hex↔Int↔CSS 命名色）
import "./core/music.js"; // 音乐/乐谱编码组（音名/MIDI/简谱/唱名 四向互转 + 频率）
import "./core/confusables.js"; // Unicode 同形字 confusables（skeleton 骨架归一化 + 混用告警）
import "./core/checksumExt.js"; // 校验和扩展组（通用 CRC + CRC-16 预设 + Fletcher16/32 + BSD/SysV sum）
import "./core/bitops.js";
import "./core/netcodecExt.js"; // 网络编码扩展组（URL query/Cookie/Basic 认证/data URI/magnet 解析）
import "./core/serial.js"; // 序列化格式识别组（protobuf/MessagePack/CBOR/BSON/PHP serialize/Java 序列化识别）
import "./core/timecodecExt.js"; // 时间戳扩展组（儒略日/Excel序列日期/Chrome时间/Twitter雪花ID）
import "./core/hexview.js"; // hexview (hexdump/range/stats)
import "./core/audiostego.js"; // 音频隐写识别组（WAV头解析/音频LSB提取/DTMF Goertzel/SSTV识别，run 单向分析类）
import "./core/esolang2.js"; // esolang 扩展组

import "./core/difftool.js"; // diff 对比工具（两文本/两 hex 逐字节 diff，run 单向分析类）
import "./core/classicExt3.js"; // 古典补全组3（otp/multiplicative/keywordcipher/simplesub/runningkey）
import "./core/fracmorse.js"; // 分数摩斯 Fractionated Morse
import "./core/hamming.js"; // 海明码纠错编解码
import { renderRecipe, rState as recipeState, addRecipeOpAt } from "./ui/recipeView.js"; // 配方链 UI
import { renderExhaustive } from "./ui/exhaustiveView.js"; // 穷举全解视图（一键全解码器穷举）
import { renderUniversalViewer, disposeUniversalViewer } from "./ui/universalViewer.js"; // 字符显示器（Hex/Unicode逐字符/不可见字符）
import { renderCodeImageViewer } from "./ui/codeImageViewer.js"; // 224编码图查询器（图形编码对照图）
import { renderQuickConv } from "./ui/quickConv.js"; // 快速换算（程序员进制联动 + 分类单位换算，MT81）
import { exhaustiveDecode } from "./core/exhaustiveDecode.js"; // 穷举全解并入首页智能解码（末尾追加可折叠区）
import { expandableInput, ensureExpStyles } from "./ui/expandableInput.js"; // 密钥/IV/crib 可展开输入框 + 弹层样式注入
import "./core/snow.js"; // Snow 行尾空白隐写（Space/Tab 编码比特）
import "./core/bazeries.js"; // Bazeries 密码（5×5 方阵+数字key分组反转）
import "./core/fenham.js"; // Fenham 密码（ASCII 二进制逐位 XOR）
import "./core/pizzini.js"; // Pizzini 密码（A-Z→4-29 数字替换）
import "./core/kamasutra.js"; // Kamasutra 爱经密码（配对表替换，自反）
import "./core/suiYanSuiYu.js"; // 随言随语（ord转4进制+字典映射）
import "./core/fuyouyue.js"; // 佛又曰+天书（AES-256-CBC+心经/道经映射）
import "./core/xiongyue.js"; // 熊曰（zlib压缩+base91+熊语字典）
import "./core/huoxingwen.js"; // 火星文+简繁转换（三向字库转换）
import "./core/qqxiuzi_hex.js"; // QQ秀 hex 族（arrow/flower/ipa/letter）
import "./core/qqxiuzi_misc.js"; // QQ秀异构族（braille/chinese/music）
import "./core/lolcode.js"; // LOLCODE 语言映射
import "./core/enigma.js"; // Enigma 恩尼格玛机
import "./core/m209.js"; // M-209 转轮密码机
import "./core/bwt.js"; // BWT 块排序变换
import "./core/clockcipher.js"; // 表盘码 / 时钟码
import "./core/bech32.js"; // Bech32 编码
import "./core/byteTools.js"; // UUID解析/VarInt/字节序交换
import "./core/lzcodec.js"; // LZString 压缩
import "./core/streamcipher.js"; // Rabbit 流密码
import "./core/flashswirl.js"; // FlashSwirl 闪旋 ARX 流密码（风之暇想）
import "./core/sevenzip.js"; // 7z 归档解析/解压（run 型，wasm 缺失降级纯头解析）
import "./core/exebridge.js"; // pyc/exe 反编译（本地桥，run 型 op）
import { decompileBytes, formatResult as formatDecompileResult } from "./core/exebridge.js"; // 拖入分派用
import "./core/crc32collision.js"; // CRC32 碰撞爆破（analysis, run 型）
import "./core/rotspecial.js"; // Rot 任意位移 + ROT8000（classic/fancy）
import "./core/pickle.js"; // Pickle 反汇编（analysis, run 型, 危险 opcode 告警）
import "./core/jjencode.js"; // JJEncode（JS 符号混淆编码, fancy）
import "./core/sm2.js"; // 国密 SM2 完整运算（GB/T 32918-2016：签名/验签+加密/解密）
import "./core/sm.js"; // 国密 ZUC/SM9（modern，ZUC 完整流密码，SM9 结构识别）
import "./core/archiveUnified.js"; // 压缩/归档归一（analysis, run 型, 复用 compress+sevenzip 纯函数）
import "./core/spoon.js"; // Spoon 语言（BF 前缀码变体, fancy）
import "./core/ssti.js"; // SSTI 关键字识别（analysis, run 型, 只识别不执行）
import "./core/pinyin.js"; // 数字转拼音 + 汉字转拼音（cn）
import "./core/goldbug.js"; // Goldbug 金甲虫密码（classic, 有 detect, 须在 detectSupplement 前）
import "./core/usbHid.js"; // USB HID 流量解析（键盘/鼠标 leftover capture data, run 型 analysis）
import "./core/exeTools.js"; // 外部 exe 工具接入(bftools/npiet/stegdetect)+GUI直启(watermarkH/JPHS/NTFS流/OpenPuff/OurSecret)，带 requiresBridge 徽章
// 以下模块已注册 op 且有 detect 的须排在下方 detectExt3/detectSupplement 之前，避免 detect 覆盖顺序错乱。
import "./core/textStego.js"; // 文本隐写入口（acrostic/everyN/caseBitStego/nthChar/wordSpacingBits，明文藏明文，区别于零宽）
import "./core/imageStructUnified.js"; // 图像结构归一（PNG/JPG/GIF/BMP 按 magic 分派 sections，有 detect）
import "./core/cryptoAddrUnified.js"; // 加密货币地址解析（BTC/ETH/LTC/DOGE/TRON，有 detect）
import "./core/fullwidth.js"; // 全角密码（有 detect）
import "./core/routecipher.js"; // 曲路密码 routeCipher（classic）
import "./core/md2.js"; // MD2 哈希
import "./core/otp.js"; // HOTP/TOTP
import "./core/kdf.js"; // PBKDF2/HKDF
import "./core/pietExec.js"; // Piet 执行（fancy，有 detect）
import "./core/carbonaro.js"; // Carbonaro 密码（classic）
import "./core/albam.js"; // Al Bhed / Albam 替换（classic）
import "./core/bfDialects.js"; // BF 方言 Blub/COW（fancy，有 detect）
import "./core/ctfCipherExt.js"; // 冷门编码/换位补齐 twinHex/trollScript/asciiSum（fancy，有 detect）+ caesarBox/curveCipher（classic）
import "./core/zipCrack.js"; // ZIP 弱口令爆破（analysis, run 型, 单向）
import "./core/chaocipher.js"; // 混沌密码 chaocipher（classic, 双向）
import "./core/john_zip.js"; // ZIP哈希提取 zip2john（analysis, run）
import "./core/rsaBatchGcd.js"; // RSA批量GCD rsaBatchGcd（analysis, run, 复用 rsatool）
import "./core/rsaHastad.js"; // RSA Håstad广播攻击 rsaHastad（analysis, run, 复用 rsatool）
import "./core/rsaPollardPm1.js"; // RSA Pollard p-1 rsaPollardPm1（analysis, run, 复用 rsatool）
import "./core/straddleCheckerboard.js"; // 跨界棋盘密码 straddleCheckerboard（classic, 双向）
import "./core/xorCribDrag.js"; // XOR拖曳已知明文 xorCribDrag（analysis, run）
import "./core/zipCrc32Brute.js"; // ZIP CRC32内容爆破 zipCrc32Brute（analysis, run）
import "./core/nihilist.js"; // 虚无党密码 nihilistCipher（classic, 双向, 原 id nihilist 已改避让 classic.js）
import "./core/solitaire.js"; // Solitaire/Pontifex 扑克流密码（classic, 双向, Schneier 官方向量验证）
import "./core/alberti.js"; // Alberti 圆盘密码（classic, 双向, 转盘 periodicShift）
import "./core/wabun.js"; // Wabun 和文摩尔斯（fancy, 双向, 假名↔摩尔斯）
import "./core/gematria.js"; // Gematria 数值密码（classic, 希伯来/英文/希腊 isopsephy 多计算法）
import "./core/squareCiphers.js"; // 四方 foursquarekw + 双方 twosquare（classic, 双向, 无 detect）
import "./core/john_7z.js"; // sevenZip2john 哈希提取（analysis, run, 无 detect）
import "./core/john_office.js"; // office2john 哈希提取（analysis, run, 无 detect）
import "./core/john_pdf.js"; // pdf2john 哈希提取（analysis, run, 无 detect）
import "./core/john_rar.js"; // rar2john 哈希提取（analysis, run, 无 detect）
import "./core/john_ssh.js"; // sshkey2john 哈希提取（analysis, run, 无 detect）
import "./core/pcapParse.js"; // pcapParse 流量解析（analysis, run, 无 detect）
import "./core/cryptoGap.js"; // 密码学缺口 rc2/lmHash/evpBytesToKey（modern+hash, 无 detect）
import "./core/blindWatermark.js"; // 盲水印 dctWatermarkEmbed/Extract（stego, 无 detect）
import "./core/bkcrack.js"; // ZipCrypto已知明文攻击 bkcrackAttack（analysis, run, wasm懒加载降级, 无 detect）
import "./core/pcapDeep.js"; // 流量深度分析 pcapTcpReassemble/pcapHttpExtract/pcapDnsTunnel/pcapIcmpPayload（analysis, run, 无 detect）
import "./core/dlp.js"; // 离散对数求解 dlp（modern, run, BSGS+Pollard rho, 无 detect）
import "./core/primeGen.js"; // 大素数生成 primeGen（radix, run, Miller-Rabin, 无 detect）
import "./core/randomSeed.js"; // 随机种子生成 randomSeed（radix, run, crypto CSPRNG, 无 detect）
import "./core/dictGen.js"; // 字典生成 dictGen（analysis, run, 笛卡尔积/掩码, 无 detect）
import "./core/elgamal.js"; // ElGamal 公钥加密 elgamal（modern, 双向, HAC §8.4, 无 detect）
import "./core/emojiAes.js"; // emoji-aes 完整版 emojiAes（fancy, 双向, 复用 aesEncrypt+md5+EMOJI_INIT）
import "./core/moyue.js"; // 魔曰 moyue（cn, 双向, vendored abracadabra-cn v3.7.7, 内部 import lib）
import "./core/mcSave.js"; // Minecraft 存档分析地基 mcLevelDat（analysis, run, 自写大端序 NBT 解析器 + level.dat 摘要, 无 detect）
import "./core/mcText.js"; // Minecraft 文本情报提取 mcTextExtract（analysis, run, Anvil MCA + 复用 mcSave NBT 解析器, 抽告示牌/书/命令/CustomName/物品名, flag 高亮, 无 detect）
import "./core/mcMap.js"; // Minecraft 地图物品渲染 mcMapRender（analysis, run, map_#.dat gzip NBT → data.colors 128×128 → MC 调色板 → 手写 PNG dataURL, 无 detect）
import "./core/bin2img.js"; // 二进制转图片 bin2img（stego, run, 0/1 位流 → 黑白点阵 PNG dataURL, 复用 mcMap encodePNG, 无 detect）
import "./core/imgFft.js"; // 图像 2D FFT 幅度谱 imgFft（stego, run, acceptsBytes, PNG/BMP → 灰度 → 行列 FFT → log 幅度谱 fftshift → PNG dataURL, 复用 lsbExtract/mcMap, 无 detect）
import "./core/mcNbt.js"; // Minecraft 通用 NBT 树查看器 mcNbtView（analysis, run, 复用 mcSave 解析器 + pcapParse inputToBytes, 折叠树/路径过滤/BigInt 不丢精度, 无 detect）
import "./core/formatSniff.js"; // 格式嗅探 formatSniff（analysis, run, 剪贴板内容识别：JWT/URL/PEM/hash/base系/Python/时间戳/坐标/助记词/ETH/BTC 特征识别, 无 detect）
import "./core/bcrypt.js"; // Bcrypt 口令哈希/校验 bcrypt（hash, run, 自带 π 常量 EksBlowfish + Radix-64, 不碰 modernExt2）
import "./core/prngAttack.js"; // PRNG 破解 prngAttack（crypto, run, LCG 参数恢复 + MT19937 untemper, 无 detect）
import "./core/hashLengthExtension.js"; // 哈希长度扩展攻击 hashLengthExtension（crypto, run, MD5 纯 JS 压缩函数续压, 无 detect）
import "./core/flagExtract.js"; // flag 自动提取器 flagExtract（analysis, run, 递归多编码 + flag{} 正则闭环, 无 detect）
import "./core/xorAnalyze.js"; // xortool 一体化 xorAnalyze（analysis, run, 汉明距离猜 keylen + 卡方打分, 无 detect）
import "./core/ttlStego.js"; // TTL 隐写 ttlStego（analysis, 双向, IP 包 TTL 序列↔比特, 4 锚点归一, 无 detect）
import "./core/spiralMatrix.js"; // 螺旋矩阵读取 spiralMatrix（analysis, 双向, LeetCode 54/59 螺旋序, 无 detect）
import "./core/nonogram.js"; // 数织 Nonogram nonogram（analysis, run, 线求解器迭代收敛, 无 detect）
import "./core/simonSpeck.js"; // NSA Simon/Speck 轻量分组密码 simonSpeck（modern, 双向, BigInt, NSA 官方向量验证, 无 detect）
import "./core/knapsack.js"; // 背包加密 Merkle-Hellman knapsack（modern, 双向, BigInt 超递增背包, 无 detect）
import "./core/dsa.js"; // DSA 签名/验签/重用k攻击 dsa（crypto, run, FIPS 186 + 内置纯 JS SHA-1, 无 detect）
import "./core/shamir.js"; // Shamir 秘密共享 shamir（crypto, 双向, GF(2^8) 拉格朗日插值, split→combine 往返验证, 无 detect）
import "./core/bmpPalette.js"; // BMP 调色板隐写分析 bmpPalette（stego, run, 1/4/8-bit 索引 BMP 调色板 LSB/索引序/未用索引, 无 detect）
import "./core/stegosaurus.js"; // Stegosaurus pyc 隐写检测 stegosaurus（forensic, run, marshal code object 静态解析 + lnotab LSB, 无 detect）
import "./core/bubblebabble.js"; // BubbleBabble 编码 bubblebabble（text, 双向, Antti Huima 2000 防误读编码, bubblepy 官方向量验证, 无 detect）
import "./core/jsEscape.js"; // JS escape 编码 jsEscape（text, 双向, 旧版 escape()/unescape(), 与原生对照验证, 无 detect）
import "./core/ppencode.js"; // Perl 关键字编码 ppencode（text, 双向, 256 词表 + 768 候选反向表, 参考交叉验证, 无 detect）
import "./core/stegpy.js"; // stegpy stegv3 隐写 stegpy（stego, 双向, bit 平面交错 + PBKDF2-Fernet, 参考交叉验证, 无 detect）
import "./core/stereogram.js"; // 立体图求解 stereogramSolver（stego, run, roll+diff 偏移解码, numpy 参考逐像素对拍, 无 detect）
import "./core/cast128.js"; // CAST-128 分组密码 cast128（modern, 双向, RFC 2144 三向量 + pycryptodome 对拍, 无 detect）
import "./core/des2Mitm.js"; // 2DES 中间相遇 des2Mitm（analysis, run, forward 表+反向查表, 本地往返验证, 无 detect）
import "./core/mimeMultipart.js"; // MIME multipart 解析 mimeMultipart（text, 双向, boundary 分 part + base64/QP 解码, 无 detect）
import "./core/lcgMore.js"; // RANDU/截断LCG randu+truncLcgRecover（analysis, run, 教学演示, 无 detect）
import "./core/shaExt.js"; // SHA 长度扩展/生日 shaLengthExtend+birthdayCollision（analysis, run, 纯 JS SHA-1/256, 无 detect）
import "./core/latticeMore.js"; // Babai CVP + HNP babaiCvp+hnpRecover（analysis, run, BigInt 格, 无 detect）
import "./core/spnAnalysis.js"; // SPN 差分线性 spnAnalysis（analysis, run, DDT/LAT 教学, 无 detect）
import "./core/collisionShow.js"; // MD5 截断碰撞 md5CollisionShow（analysis, run, 生日法教学, 无 detect）
import "./core/pqcLite.js"; // LWE/NTRU 玩具 lweToy+ntruToy（crypto, run, 教学级小参数, 无 detect）
import "./core/crc32Reverse.js"; // CRC32 反向碰撞 crc32Reverse（analysis, run, 表驱动反推4字节补丁, 参考交叉验证, 无 detect）
import "./core/roar.js"; // 兽音译者 roar 4字符codec变体（fancy, 双向, hex偏移+codec映射, 反编参考交叉验证, 无 detect）
import "./core/bfSwap.js"; // BF 交换重跑变体 bfSwap（fancy, 双向, 逗号空操作+失败7字符对称交换重跑, 无 detect）
import "./core/geffe.js"; // Geffe 生成器/相关攻击 geffe（analysis, run, 3 LFSR 组合 + 相关攻击, 子代理交付, 无 detect）
import "./core/pcapRepair.js"; // pcap 文件修复 pcapRepair（analysis, run, magic/字节序/全局头/incl_len 诊断修复, 无 detect）
import "./core/spectrogram.js"; // 音频频谱图 spectrogram（stego, run, STFT + radix-2 FFT + Hann 窗 + magma 色阶 → PNG dataURL, 复用 audiostego/mcMap, 无 detect）
import "./core/lfsrRecover.js"; // LFSR 序列恢复 lfsrRecover（analysis, run, Berlekamp-Massey 求最短 LFSR + 反馈多项式 + 外推预测, 无 detect）
import "./core/xorshiftRecover.js"; // xorshift 状态恢复 xorshiftRecover（analysis, run, Marsaglia xorshift32/64/128 逆位运算恢复种子+预测, 无 detect）
import "./core/yenc.js"; // yEnc 编解码 yenc（text, 双向, +42 mod 256 + '=' 转义关键字节, UTF-8 字节, 往返验证, 无 detect）
import "./core/binhex.js"; // BinHex 4.0 编解码 binhex（text, 双向, 6-bit 码表 + RLE90 + crc_hqx CRC 校验, Python binhex 参考, 往返验证, 无 detect）
import "./core/a51.js"; // GSM A5/1 流密码 a51（modern, 双向自反, 三 LFSR 19/22/23 多数表决钟控, Briceno/Goldberg/Wagner 官方向量验证, 无 detect）
import "./core/a52.js"; // GSM A5/2 流密码 a52（modern, 双向自反, R4 择多钟控 + 掩码位延迟输出, Briceno 官方实现 + C oracle 交叉验证, 无 detect）
import "./core/e0.js"; // 蓝牙 E0 流密码 e0（modern, 双向自反, 4 LFSR 求和组合器 + 2bit 记忆, Bluetooth Core Spec + Python 参考交叉验证, 无 detect）
import "./core/hc128.js"; // HC-128 流密码 hc128（modern, 双向自反, 512×32bit P/Q 表, Crypto++ 官方向量验证, 无 detect）
import "./core/hc256.js"; // HC-256 流密码 hc256（modern, 双向自反, 1024×32bit P/Q 表, Crypto++ 官方向量验证, 无 detect）
import "./core/sosemanuk.js"; // Sosemanuk 流密码 sosemanuk（modern, 双向自反, LFSR+FSM+Serpent S2, eSTREAM 官方向量 + C oracle 对拍, 无 detect）
import "./core/spritz.js"; // Spritz 流密码 spritz（modern, 双向自反, 论文 2014-10-27 版 a 计数吸收, 权威向量验证, 无 detect）
import "./core/vmpc.js"; // VMPC 流密码 vmpc（modern, 双向自反, 作者官方实现 BASIC/FULL 模式, 官方向量验证, 无 detect）
import "./core/mickey.js"; // MICKEY-128 2.0 流密码 mickey（modern, 双向自反, 160 位双寄存器不规则钟控, eSTREAM 官方源码逐行移植, 官方向量验证, 无 detect）
import "./core/ecdsaReuseK.js"; // ECDSA nonce 重用攻击 ecdsaReuseK（crypto, run, 纯数论恢复 k+私钥 d + 内置 secp256k1/P-256 EC 点乘公钥校验消歧, 自造签名验证, 无 detect）
import "./core/rabin.js"; // Rabin 密码 rabin（crypto, 双向, x²≡c mod n 平方根解密四根, RFC 无但经典教学, 往返验证, 无 detect）
import "./core/x25519.js"; // X25519 密钥交换 x25519（crypto, run, Curve25519 Montgomery ladder, RFC 7748 §5.2 官方向量验证, 无 detect）
import "./core/ed25519.js"; // Ed25519 签名/验签 ed25519（crypto, run, RFC 8032 EdDSA, Node 原生预言机多种子交叉验证, 无 detect）
import "./core/siphash.js"; // SipHash-2-4 MAC siphash（hash, run, 官方 vectors_sip64 8 向量验证, 无 detect）
import "./core/scrypt.js"; // scrypt 口令密钥派生 scrypt（crypto, run async, RFC 7914, Node crypto.scryptSync 对拍 5 向量验证, 无 detect）
import "./core/balloon.js"; // Balloon 密钥派生 balloon（crypto, run, Boneh 2016 原版 SHA-256 实例 + 盐参与访问模式, 5 组权威向量验证, 无 detect）
import "./core/lyra2.js"; // Lyra2 密钥派生 lyra2（crypto, run, PHC 官方 Lyra2.c/Sponge.c 移植, 官方向量验证, 无 detect）
import "./core/yescrypt.js"; // yescrypt 密钥派生 yescrypt（crypto, run, openwall 官方三模式 scrypt/WORM/RW pwxform, 官方 7 组向量验证, 无 detect）
import "./core/blake3.js"; // BLAKE3 哈希 blake3（hash, run, 官方 test_vectors.json 10 向量验证含多 chunk 树边界, 无 detect）
import "./core/paillier.js"; // Paillier 加法同态加密 paillier（crypto, run, decrypt(encrypt)=m + E(m1)·E(m2)=E(m1+m2) 同态性质验证, 无 detect）
import "./core/schnorr.js"; // Schnorr 签名 schnorr（crypto, run, secp256k1 + 内嵌 SHA-256, sign/verify + nonce 重用恢复 d/k, Node SHA 对拍验证, 无 detect）
import "./core/magma.js"; // GOST Magma 分组密码 magma（modern, 双向, GOST R 34.12-2015 32轮 Feistel, 官方 §A.2 向量验证, 无 detect）
import "./core/present.js"; // PRESENT 轻量分组密码 present（modern, 双向, PRESENT-80 31轮 SPN, 官方论文 4 向量验证, 无 detect）
import "./core/serpent.js"; // Serpent 分组密码 serpent（modern, 双向, AES 竞赛亚军 32轮 SPN, 128/192/256位密钥, NESSIE 514 向量全过, 无 detect）
import "./core/aria.js"; // ARIA 分组密码 aria（modern, 双向, 韩国标准 KS X 1213/RFC 5794, 128位分组 128/192/256位密钥, RFC 5794 附录A 三向量验证, 无 detect）
import "./core/seed.js"; // SEED 分组密码 seed（modern, 双向, 韩国 KISA 标准 RFC 4269, 128位分组 128位密钥 16轮 Feistel, RFC 4269 附录B 两向量+中间轮密钥验证, 无 detect）
import "./core/camellia.js"; // Camellia 分组密码 camellia（modern, 双向, NTT/三菱 RFC 3713, 128位分组 128/192/256位密钥 18/24轮, RFC 3713 附录C 三向量+参考实现逐段对拍, 无 detect）
import "./core/pearson.js"; // Pearson 哈希 pearson（hash, run, 8-bit 逐字节查表, 表为 0-255 合法排列自检 + 确定性验证, 无 detect）
import "./core/whirlpool.js"; // Whirlpool 哈希 whirlpool（hash, run, ISO/IEC 10118-3 512-bit Miyaguchi-Preneel, 官方 8 向量验证, 无 detect）
import "./core/skein.js"; // Skein 哈希 skein（hash, run, NIST SHA-3 决赛候选, Threefish Miyaguchi-Preneel 压缩, 256/512/1024 状态 × 224~1024 输出, C 参考 oracle 126 交叉验证, 无 detect）
import "./core/grostl.js"; // Grøstl 哈希 grostl（hash, run, NIST SHA-3 决赛候选, 宽管道 P/Q 双置换, 256/512 位, C oracle 36 交叉验证, 无 detect）
import "./core/jh.js"; // JH 哈希 jh（hash, run, NIST SHA-3 决赛候选, Hongjun Wu 1024 位 bitslice 42 轮, 224/256/384/512 输出, C oracle 72 交叉验证, 无 detect）
import "./core/streebog.js"; // Streebog 哈希 streebog（hash, run, 俄罗斯国标 GOST R 34.11-2012/RFC 6986, 512/256 位, RFC §10 三向量验证, 无 detect）
import "./core/threefish.js"; // Threefish 可调分组密码 threefish（modern, 双向, Skein v1.3 内建 256/512/1024 位分组, 72/80轮无密钥调度器+128位tweak, Crypto++ threefish.txt 官方向量验证, 无 detect）
import "./core/skipjack.js"; // Skipjack 分组密码 skipjack（modern, 双向, NSA 1998 解密 64位分组 80位密钥 32轮, NIST SP800-17 Table 6 官方向量验证, 无 detect）
import "./core/mars.js"; // MARS 分组密码 mars（modern, 双向, IBM 1998 AES决赛圈 128位分组 128/192/256位密钥 32轮, Crypto++ marsval.dat 官方向量验证, 无 detect）
import "./core/xxhash.js"; // xxHash 极速哈希 xxhash（hash, run, xxHash32/64 官方向量自检, 非加密, 无 detect）
import "./core/cityhash.js"; // CityHash 非加密哈希 cityhash（hash, run, Google CityHash32/64, city-test.cc 官方 299 组向量全过, 无 detect）
import "./core/rc4Visualize.js"; // RC4 KSA/PRGA 可视化 rc4Visualize（analysis, run, 逐步展示 KSA 打乱 + PRGA 密钥流, 无 detect）
import "./core/f5stego.js"; // F5 JPEG 隐写提取 f5stego（stego, run, acceptsBytes, 熵解码+密钥置换+(1,2^k-1,k)矩阵编码, 仅提取, 无 detect）
import "./core/lllAttack.js"; // 格基归约 LLL + 背包低密度攻击 CJLOSS（crypto, run, BigInt 精确有理 GSO, 无 detect）
import "./core/xiangyue.js"; // 想曰 XiangYue 完整版解密 xiangyue（cn, run async, 中/日/韩/Emoji/零宽/象形映射 → Argon2id/PBKDF2 + ChaCha20-Poly1305 + AES-CTR + zlib, 纯JS原语自验, 无 detect）
import "./core/lightweightStream.js"; // eSTREAM/NIST 轻量级流密码 trivium/grainV1/grain128aead（modern, 双向, 官方向量验证）
import "./core/fengCodec.js"; // 风之暇想 uid=243467 编码 dxBase64（base, 双向, deflate+salt XOR+CRC16）/ yueChang 曰唱（cn, 双向, PBKDF2+AES-GCM+拟声字映射, 源码逐行核验）
import "./core/radixAll.js"; // 一键多进制转换 radixAll（radix, run, 自动嗅探 + 2/8/10/16/32/36/62 进制对照 + Base64 + 字节/码位视图 + 负数补码, BigInt, 无 detect）
import "./core/progCalc.js"; // 程序员计算器 progCalc（radix, run, 手写递归下降解析器无 eval, & | ^ ~ << >> >>> rotl/rotr, 8/16/32/64 位字宽 BigInt 回绕, 无 detect）
import "./core/unitConv.js"; // 单位换算 unitConv（data, run, 数据量 SI/IEC 两制并列 + 速率 + 时间 + 时间戳纪元 + 频率 + 角度, BigInt 有理数, 无 detect）
import "./core/gifTiming.js"; // GIF 帧时序隐写 gifTiming（stego, run, GCE Delay 厘秒→数字/ASCII/二进制阈值三模式, 无 detect）
import "./core/jpgSizeRecover.js"; // JPEG 宽高修复 jpgSizeRecover（forensic, run, SOF+霍夫曼熵解码数 MCU 反推真实高度, 无 detect）
import "./core/zipRepair.js"; // ZIP 伪加密修复/置位 zipRepair+zipPseudoEncrypt（forensic, run, EOCD→CD→LFH 清/置通用位标志 bit0, 无 detect）
import "./core/stringsExtract.js"; // 字符串提取 stringsExtract（forensic, run, ASCII/UTF-16LE 双模式可打印串扫描, 无 detect）
import "./core/jwtCrack.js"; // JWT 密钥爆破 jwtCrack（modern, run async, HS256/384/512 弱密钥字典爆破, 无 detect）
import "./core/zstegScan.js"; // LSB 全组合扫描 zstegScan（stego, run, 位平面×通道×位序×行列组合+可读性打分, 无 detect）
import "./core/pdfObjects.js"; // PDF 对象解析 pdfObjects（forensic, run, 对象表+FlateDecode 流解压预览, 无 detect）
import "./core/ooxmlMeta.js"; // OOXML 元数据提取 ooxmlMeta（forensic, run, docx/xlsx/pptx 的 docProps XML 键值, 无 detect）
import "./core/apkManifest.js"; // APK Manifest 解析 apkManifest（forensic, run, 二进制 AXML/明文 XML 双形态, 无 detect）
import "./core/elfInfo.js"; // ELF 可执行信息 elfInfo（forensic, run, 头/程序头/动态节依赖库, 无 detect）
import "./core/peInfo.js"; // PE 可执行信息 peInfo（forensic, run, COFF+可选头 EXE/DLL/子系统, 无 detect）
import "./core/lsbEmbed.js"; // LSB 嵌入（出题）lsbEmbed（stego, run, 封面像素低位写载荷→PNG, 无 detect）
import "./core/zipCreate.js"; // ZIP 创建（出题）zipCreate（forensic, run, 单文件 Stored/Deflated ZIP 生成, 无 detect）
import "./core/deepsoundExtract.js"; // DeepSound 提取 deepsoundExtract（forensic, run async, WAV 采样低位 DSC2/DSCF, 无 detect）
import "./core/detectExt3.js"; // EASY 30 op detect 补齐（须在所有 op 注册后）
import "./core/detectSupplement.js"; // 编码类 detect 覆盖补齐（须在所有 op 注册后）

// ---------- 启动加载屏（避免白屏，最早显示，纯文字+CSS 不依赖字库/图标）----
// 模块 import 已同步完成到此，立即盖屏 → 启动尾部渐隐。
showLoadingScreen();
setLoadingProgress(30, "ui.loading.core");

// ---------- DOM 句柄 ----------
const $nav = document.getElementById("sidenav");
const $ws = document.getElementById("workspace");

// ---------- 应用状态 ----------
const state = {
  view: "home",         // "home" | "op"
  opId: null,           // 当前 op id
  dir: "decode",        // "encode" | "decode"
  params: {},           // 当前 op 的参数值
  navCollapsed: false,  // 侧栏 rail 折叠态（仿 Win11 任务管理器：只留图标）
  expandedCats: [],     // 展开二级菜单的分类 id 集合（支持多个同时展开，非手风琴）
 // 首页一把梭输入缓存（切到别的菜单再回首页，输入/工具栏不丢）
  home: { input: "", crib: "", intensive: false },
  _routing: false,      // 路由驱动渲染时置位，避免 selectOp 回写 hash 造成回环
  _animatedCats: [],    // 已放过展开动画的分类集合，防 selectOp 重渲染时二级菜单动画重放
  ioFont: 17,           // IO 框字号（会话态，不持久化），A-/A+ 调节，范围 11-28（默认 17）
  navW: 0,              // 侧栏拖拽宽度（会话态，不持久化，0=用 CSS 默认）
};
// 折叠态从 localStorage 恢复（记住用户偏好）
try { state.navCollapsed = localStorage.getItem("ebctf_nav_collapsed") === "1"; } catch { /* 隐私模式忽略 */ }

// ============ 工具函数 ============
function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === "class") n.className = v;
    else if (k === "html") n.innerHTML = v;
    else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined && v !== false) n.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children) {
    if (c == null) continue;
    n.append(c.nodeType ? c : document.createTextNode(c));
  }
  return n;
}
function msym(name, cls = "") {
  const span = el("span", { class: "msym " + cls });
  span.innerHTML = iconSvg(name);
  return span;
}

// 给非原生可聚焦元素（div 当按钮用）补键盘可达性：role=button + tabindex + Enter/Space 触发。
// 侧栏一级导航项、折叠开关、置顶项都是 div onclick，键盘用户 Tab 不到——用本 helper 补齐。
// 返回可摊进 el attrs 的对象（含 role/tabindex/onkeydown），fn 是激活回调（与 onclick 同）。
function keyBtn(fn) {
  return {
    role: "button",
    tabindex: "0",
    onkeydown: (e) => {
      if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") {
        e.preventDefault();
        fn(e);
      }
    },
  };
}

// 主 IO 编辑区工厂：contenteditable <div> 取代 <textarea>，让天珩全字库的
// OpenType 特性（calt/liga/ccmp 连字·上下文替换·组合）走正常文本渲染管线真正生效
// （textarea 渲染限制会吞掉这些特性）。
// 关键设计：在 div 上把 .value 代理到 textContent（纯文本，杜绝 HTML 注入 + 保留换行语义）
// 这样原有大量 `el.value` 读写代码几乎无需改动即可透明工作。
// - readonly:true → contenteditable="false"（仍可选中复制），加 .io-readonly 类
// - placeholder → data-placeholder + CSS :empty::before 模拟（div 无原生 placeholder）
// - 粘贴强制纯文本（execCommand insertText / clipboardData text/plain）
// - Enter 插入纯 "\n"（避免浏览器塞 <div>/<br> 导致 textContent 丢换行）
function ioArea(attrs = {}) {
  const a = { ...attrs };
  const ph = a.placeholder; delete a.placeholder;
  const ro = a.readonly === true || a.readonly === ""; delete a.readonly;
  delete a.spellcheck; delete a.rows; // div 上无意义，统一处理
  const div = el("div", a);
  div.setAttribute("contenteditable", ro ? "false" : "true");
  div.setAttribute("spellcheck", "false");
  if (ph) div.setAttribute("data-placeholder", ph);
  if (ro) div.classList.add("io-readonly");
 // .value 代理 textContent：读写纯文本，保留换行（配合 CSS white-space:pre-wrap）
  Object.defineProperty(div, "value", {
    get() { return this.textContent; },
    set(v) { this.textContent = v == null ? "" : String(v); },
    configurable: true,
  });
  if (!ro) {
 // 粘贴净化：只取纯文本，杜绝富文本/HTML 注入
    div.addEventListener("paste", (e) => {
      e.preventDefault();
      const cd = e.clipboardData || window.clipboardData;
      const text = cd ? cd.getData("text/plain") : "";
      if (!document.execCommand || !document.execCommand("insertText", false, text)) {
        const sel = window.getSelection();
        if (sel && sel.rangeCount) {
          const range = sel.getRangeAt(0);
          range.deleteContents();
          const node = document.createTextNode(text);
          range.insertNode(node);
          range.setStartAfter(node); range.collapse(true);
          sel.removeAllRanges(); sel.addRange(range);
        } else {
          div.textContent = div.textContent + text;
        }
      }
    });
 // Enter → 纯 "\n"（不让浏览器插入 <div>/<br>，保证 textContent 换行语义正确）。
 // Ctrl/Meta+Enter 放行给上层的 convert 快捷键；Shift+Enter 也走纯换行。
    div.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        document.execCommand && document.execCommand("insertText", false, "\n");
      }
    });
 // 保险：内容删空后清掉浏览器残留的 <br>，让 :empty placeholder 重新生效
    div.addEventListener("input", () => {
      if (div.textContent === "") div.innerHTML = "";
    });
  }
  return div;
}

// 编辑框记事本化——全选 / 导出 / 快捷键。
// 全选 io-area（textarea 与 contenteditable div 两种形态都要处理）。
function selectAllIO(area) {
  try {
    if (typeof area.select === "function") { area.select(); return; }
 // contenteditable div：用 Range 选中全部子节点
    const sel = window.getSelection();
    if (!sel) return;
    const range = document.createRange();
    range.selectNodeContents(area);
    sel.removeAllRanges();
    sel.addRange(range);
    area.focus();
  } catch { /* 忽略 */ }
}
// 导出文本为 .txt 文件（纯前端 Blob，零外发）。fname 缺省带时间戳。
function exportTextAsFile(text, fname) {
  try {
    const name = fname || ("ebctf-" + new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19) + ".txt");
    const blob = new Blob([text == null ? "" : String(text)], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = name;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch { /* 忽略 */ }
}
// 给 io-area 挂记事本快捷键：Ctrl+A 全选（div 形态浏览器默认可能越界选到全页，显式接管）
// Ctrl+S 导出为 txt（拦截浏览器保存网页）。Ctrl+Z 撤销走浏览器/contenteditable 原生，不干预。
function attachEditorShortcuts(area, opts = {}) {
  area.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
      const k = e.key.toLowerCase();
      if (k === "a") { e.preventDefault(); selectAllIO(area); }
      else if (k === "s") { e.preventDefault(); exportTextAsFile(area.value, opts.exportName); }
    }
  });
}

let _toastTimer = null;
function toast(msg) {
  document.querySelector(".toast")?.remove();
  const t = el("div", { class: "toast" }, msg);
  document.body.append(t);
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => t.remove(), 2000);
}

// ============ 左侧导航渲染 ============
// 结构：顶部折叠开关（rail toggle）+ 分类列表。
// 每个分类是可展开的手风琴：点分类头 → 展开二级菜单（该分类全部 op），再点某 op → selectOp。
// 折叠态（rail）：只留图标，hover 出 tooltip；点分类图标直接跳该分类首个 op（无处摆二级）。
// 窄屏（≤860px）CSS 强制 rail（topbar-responsive.css），JS 侧必须同步此态，否则二级菜单在 60px 宽的
// rail 里渲染成横向溢出（穿模）。navRail() = 用户手动折叠 或 视口窄到断点。断点值与 topbar-responsive.css
// / customImplEditor 一致（860px）。
const NAV_RAIL_BP = 860;
function navRail() {
  return state.navCollapsed || window.innerWidth <= NAV_RAIL_BP;
}
function renderNav() {
  $nav.innerHTML = "";
  $nav.classList.toggle("collapsed", navRail());
 // 收起态清空动画追踪：下次展开任意分类都重新播入场动画
  if (!state.expandedCats.length) state._animatedCats = [];

 // 折叠/展开开关（顶部）
  const toggle = el("div",
    { class: "nav-toggle", title: navRail() ? t("ui.nav.expand") : t("ui.nav.collapse"),
      "aria-label": navRail() ? t("ui.nav.expand") : t("ui.nav.collapse"),
      onclick: toggleNav, ...keyBtn(toggleNav) },
    msym(navRail() ? "chevron_right" : "chevron_left"),
  );
  $nav.append(toggle);

  for (const cat of CATEGORIES) {
    const isHome = cat.id === "home";
    const count = isHome ? 0 : opsByCat(cat.id).length;
    const curCat = state.view === "op" ? getOp(state.opId)?.cat : (state.view === "home" ? "home" : null);
    const active = curCat === cat.id;
    const expanded = state.expandedCats.includes(cat.id) && !navRail() && !isHome;

    const item = el("div",
      { class: "nav-item" + (active ? " on" : "") + (cat.pinned ? " pinned" : "") + (expanded ? " expanded" : "") + (cat.id.startsWith("bridge") ? " bridge" : ""),
        title: navRail() ? catName(cat) : "",
        onclick: () => onNavClick(cat), ...keyBtn(() => onNavClick(cat)) },
      msym(cat.icon),
      el("span", { class: "nav-label" }, catName(cat)),
      count ? el("span", { class: "nav-count" }, String(count)) : null,
      isHome || navRail() ? null : msym(expanded ? "expand_more" : "chevron_right", "nav-caret"),
    );
    $nav.append(item);

 // 配方链导航置顶项——紧贴「首页·一把梭」下方，与首页并列为顶级入口。
 // 配方链是多操作串联工作台（顶栏也有入口），这里给导航一个显眼置顶项，减少一次找。
    if (isHome) {
      const recipeActive = state.view === "recipe";
      const recipeItem = el("div",
        { class: "nav-item nav-recipe" + (recipeActive ? " on" : ""),
          title: navRail() ? t("ui.nav.recipe") : "",
          onclick: () => goRecipe(), ...keyBtn(() => goRecipe()) },
        msym("account_tree"),
        el("span", { class: "nav-label" }, t("ui.nav.recipe")),
      );
      $nav.append(recipeItem);

 // 万能查看器导航置顶项（与智能解码并列置顶）。
      const inspectActive = state.view === "inspect";
      const inspectItem = el("div",
        { class: "nav-item nav-inspect" + (inspectActive ? " on" : ""),
          title: navRail() ? t("ui.nav.inspect") : "",
          onclick: () => goInspect(), ...keyBtn(() => goInspect()) },
        msym("visibility"),
        el("span", { class: "nav-label" }, t("ui.nav.inspect")),
      );
      $nav.append(inspectItem);

 // 编码图查询器导航置顶项（图形编码对照图鉴）。
      const codeimgActive = state.view === "codeimg";
      const codeimgItem = el("div",
        { class: "nav-item nav-codeimg" + (codeimgActive ? " on" : ""),
          title: navRail() ? t("ui.nav.codeimg") : "",
          onclick: () => goCodeImg(), ...keyBtn(() => goCodeImg()) },
        msym("menu_book"),
        el("span", { class: "nav-label" }, t("ui.nav.codeimg")),
      );
      $nav.append(codeimgItem);

 // 快速换算导航置顶项（程序员进制联动 + 分类单位换算，MT81）。
      const quickconvActive = state.view === "quickconv";
      const quickconvItem = el("div",
        { class: "nav-item nav-quickconv" + (quickconvActive ? " on" : ""),
          title: navRail() ? t("ui.nav.quickconv") : "",
          onclick: () => goQuickConv(), ...keyBtn(() => goQuickConv()) },
        msym("calculate"),
        el("span", { class: "nav-label" }, t("ui.nav.quickconv")),
      );
      $nav.append(quickconvItem);
    }

 // 二级菜单：展开态且非折叠时，列出该分类全部 op
    if (expanded) {
 // 仅「分类刚展开」那一刻放入场动画；已展开态下切 op（selectOp 重渲染）不重放，消除闪烁
      const justOpened = !state._animatedCats.includes(cat.id);
      const sub = el("div", { class: "nav-sub" + (justOpened ? " animate-in" : "") });
      for (const op of opsByCat(cat.id)) {
        const hot = CTF_HOT.has(op.id);            // CTF 常考项高亮
        const meta = hot ? CTF_HOT_META[op.id] : null;
        const cls = "nav-subitem"
          + (state.opId === op.id ? " on" : "")
          + (op.requiresBridge ? " bridge" : "")
          + (hot ? " ctf-hot" : "")
          + (meta && meta.rank === 1 ? " ctf-hot-top" : "");
 // 渲成 <a href="#/op/id">，中键/Ctrl 点可在新标签打开；左键仍走 SPA 选中
        const a = el("a",
          { class: cls, href: "#/op/" + op.id,
            draggable: "true",   // 可拖到配方链画布追加/插入节点（不在画布 drop 则无副作用）
            title: meta ? meta.note : "",
            onclick: (e) => {
              if (e.ctrlKey || e.metaKey || e.button === 1) return; // 放行新标签打开
              e.preventDefault(); e.stopPropagation(); selectOp(op.id);
            },
            ondragstart: (e) => {
 // 自定义 MIME 承载 opId，供 recipeView 画布识别；同带 text/plain 兜底不破坏原生行为
              if (!e.dataTransfer) return;
              e.dataTransfer.effectAllowed = "copy";
              try { e.dataTransfer.setData("application/x-ebctf-op", op.id); } catch { /* 某些环境禁用 */ }
              try { e.dataTransfer.setData("text/plain", opName(op)); } catch { /* 忽略 */ }
            } },
          op.requiresBridge ? el("span", { class: "exe-badge" }, "EXE") : null,
          hot ? msym("star", "ctf-star") : null,
          el("span", { class: "nav-subitem-label" }, opName(op)),
        );
        sub.append(a);
        attachTouchDragToRecipe(a, () => op.id);
      }
      $nav.append(sub);
      if (!state._animatedCats.includes(cat.id)) state._animatedCats.push(cat.id); // 记录已放过动画的分类
    }

    if (cat.pinned) $nav.append(el("div", { class: "nav-sep" }));
  }
}

function toggleNav() {
  state.navCollapsed = !state.navCollapsed;
  if (state.navCollapsed) state.expandedCats = []; // 折叠时收起所有二级
  try { localStorage.setItem("ebctf_nav_collapsed", state.navCollapsed ? "1" : "0"); } catch { /* 忽略 */ }
  renderNav();
}

function onNavClick(cat) {
  if (cat.id === "home") {
    goHome();
    return;
  }
  const ops = opsByCat(cat.id);
  if (!ops.length) { toast(t("ui.op.emptyCat", catName(cat))); return; }

 // 折叠态（含窄屏 rail）：没地方摆二级菜单，直接跳该分类首个 op
  if (navRail()) { selectOp(ops[0].id); return; }

 // 展开态：点已展开的分类头 → 收起；否则展开。支持多个分类同时展开（非手风琴）。
  state.expandedCats = state.expandedCats.includes(cat.id)
    ? state.expandedCats.filter((c) => c !== cat.id)
    : [...state.expandedCats, cat.id];
  renderNav();
}

// 回首页（首页输入已存 state.homeInput，renderHome 会自动恢复，进度不丢）
function goHome() {
  state.view = "home";
  state.opId = null;
  state.expandedCats = [];
  writeHash("#/home");
  renderNav();
  renderWorkspace();
}

function selectOp(id) {
  const op = getOp(id);
  if (!op) return;
  state.view = "op";
  state.opId = id;
  state.params = defaultParams(op);
  if (!state.expandedCats.includes(op.cat)) state.expandedCats.push(op.cat); // 保持该 op 所在分类展开，二级菜单高亮当前 op
 // 单向 run 工具无方向；双向的默认 decode（CTF 场景解码为主）
  state.dir = op.decode ? "decode" : (op.encode ? "encode" : "run");
  writeHash("#/op/" + id);   // 地址栏反映当前 op，可中键多开 / 刷新保持
  renderNav();
  renderWorkspace();
}

// ============ hash 路由（可中键新标签多开、刷新/分享定位到具体 op）============
// 路由形态：#/home（首页一把梭）、#/op/<opId>（某个功能）。
// writeHash 带 _routing 标志，避免自己写 hash 又触发 hashchange 造成二次渲染。
let _routing = false;
// 授权信息（启动异步 loadLicense 填入；未读到前按开源自编译默认显示）。
let _license = OPENSOURCE_LICENSE;
function writeHash(h) {
  if (location.hash === h) return;
  _routing = true;
  location.hash = h;
 // hashchange 是异步派发，下一拍复位标志
  setTimeout(() => { _routing = false; }, 0);
}
function applyRoute() {
  const h = location.hash || "";
  const m = h.match(/^#\/op\/(.+)$/);
  if (h === "#/recipe") {
    state.view = "recipe";
    state.opId = null;
    state.expandedCats = [];
    renderNav();
    renderWorkspace();
  } else if (h === "#/exhaust") {
    state.view = "exhaust";
    state.opId = null;
    state.expandedCats = [];
    renderNav();
    renderWorkspace();
  } else if (h === "#/inspect") {
    state.view = "inspect";
    state.opId = null;
    state.expandedCats = [];
    renderNav();
    renderWorkspace();
  } else if (h === "#/codeimg") {
    state.view = "codeimg";
    state.opId = null;
    state.expandedCats = [];
    renderNav();
    renderWorkspace();
  } else if (h === "#/quickconv") {
    state.view = "quickconv";
    state.opId = null;
    state.expandedCats = [];
    renderNav();
    renderWorkspace();
  } else if (h === "#/about") {
    state.view = "about";
    state.opId = null;
    state.expandedCats = [];
    renderNav();
    renderWorkspace();
  } else if (h === "#/plugins") {
    state.view = "plugins";
    state.opId = null;
    state.expandedCats = [];
    renderNav();
    renderWorkspace();
  } else if (m && getOp(decodeURIComponent(m[1]))) {
    selectOpFromRoute(decodeURIComponent(m[1]));
  } else {
 // 无匹配 / #/home → 首页
    state.view = "home";
    state.opId = null;
    state.expandedCats = [];
    renderNav();
    renderWorkspace();
  }
}
// 与 selectOp 相同，但不再回写 hash（本身就是被 hash 驱动进来的），防循环
function selectOpFromRoute(id) {
  const op = getOp(id);
  if (!op) return;
  state.view = "op";
  state.opId = id;
  state.params = defaultParams(op);
  if (!state.expandedCats.includes(op.cat)) state.expandedCats.push(op.cat);
  state.dir = op.decode ? "decode" : (op.encode ? "encode" : "run");
  renderNav();
  renderWorkspace();
}
window.addEventListener("hashchange", () => {
  if (_routing) return; // 自己 writeHash 触发的，状态已同步，跳过
  applyRoute();
});

// ============ 工作区渲染 ============
function renderWorkspace() {
  // 离开字符显示器视图：释放 _rerender 闭包对旧视图 DOM 的引用（性能审计 H3，
  // hex 满载可达 13.9 万节点，不释放则逛其他视图的整段时间不可回收）
  if (state.view !== "inspect") disposeUniversalViewer();
  $ws.innerHTML = "";
  if (state.view === "home") return renderHome();
  if (state.view === "recipe") return renderRecipe($ws);
  if (state.view === "exhaust") return renderExhaustive($ws);
  if (state.view === "inspect") return renderUniversalViewer($ws);
  if (state.view === "codeimg") return renderCodeImageViewer($ws);
  if (state.view === "quickconv") return renderQuickConv($ws);
  if (state.view === "about") return renderAbout($ws);
  if (state.view === "plugins") return renderPluginsView($ws);
  return renderOp();
}

// 进入配方链视图
function goRecipe() {
  state.view = "recipe";
  state.opId = null;
  state.expandedCats = [];
  writeHash("#/recipe");
  renderNav();
  renderWorkspace();
}

// 进入万能查看器视图
function goInspect() {
  state.view = "inspect";
  state.opId = null;
  state.expandedCats = [];
  writeHash("#/inspect");
  renderNav();
  renderWorkspace();
}

// 进入编码图鉴视图（224 编码图查询器）
function goCodeImg() {
  state.view = "codeimg";
  state.opId = null;
  state.expandedCats = [];
  writeHash("#/codeimg");
  renderNav();
  renderWorkspace();
}

// 进入快速换算视图（程序员进制联动 + 分类单位换算，MT81）
function goQuickConv() {
  state.view = "quickconv";
  state.opId = null;
  state.expandedCats = [];
  writeHash("#/quickconv");
  renderNav();
  renderWorkspace();
}

// 进入关于页（独立路由 #/about，非弹窗，工作区内渲染，与 op 页同形）
function goAbout() {
  state.view = "about";
  state.opId = null;
  state.expandedCats = [];
  writeHash("#/about");
  renderNav();
  renderWorkspace();
}

// 进入插件/MCP 页（独立路由 #/plugins，工作区内渲染，非弹窗）。
function goPlugins() {
  state.view = "plugins";
  state.opId = null;
  state.expandedCats = [];
  writeHash("#/plugins");
  renderNav();
  renderWorkspace();
}

// 插件页渲染：懒加载面板 UI（不拖首屏），渲染进工作区容器。
function renderPluginsView(host) {
  import("./ui/pluginPanel.js")
    .then(({ renderPluginsPage }) => renderPluginsPage(host))
    .catch((e) => {
      host.append(el("p", { class: "plugin-empty" },
        t("ui.plugin.loadErr", e && e.message ? e.message : e)));
    });
}

// ---- 一把梭首页（Magic 智能识别）----
function renderHome() {
  const wrap = el("div", { class: "home-hero" });
  wrap.append(
    el("div", { class: "op-head" },
      el("div", { class: "op-title" }, msym("bolt_filled"), t("ui.home.title")),
      el("div", { class: "op-desc" }, t("ui.home.desc")),
    ),
  );

 // Magic 工具栏：crib 目标特征 + intensive 深度爆破开关
  const cribInput = el("input", {
    type: "text", class: "magic-crib",
    placeholder: t("ui.home.cribPlaceholder"),
    spellcheck: "false",
  });
 // 目标特征默认填充常见 CTF 特征（软加权：命中置顶高亮，不删其他候选，见 magic.js）。
 // 首次进入给默认；用户清空后尊重空值（用 undefined 区分「没设过」和「主动清空」）。
  if (state.homeCrib === undefined) state.homeCrib = DEFAULT_CRIB;
  cribInput.value = state.homeCrib;                 // 恢复上次 crib
 // 密钥框（需求3）：填了 key → 一键解码把 AES/DES/RC4/XOR/vigenere 等带密钥加解密 op
 // 也纳入尝试，用 CTF 常考默认参数（IV=0、常见模式/编码组合）一起跑。空则不试 keyed。
  const keyInput = el("input", {
    type: "text", class: "magic-crib magic-key",
    placeholder: t("ui.home.keyPlaceholder"),
    spellcheck: "false",
  });
  keyInput.value = state.homeKey || "";
 // 解码强度（替代原「深度爆破 / 多层链式」两个裸开关）：按钮开弹窗，
 // 内含 5 档预设滑块（快速→最强，按 CTF 考点热→冷逐层放开）+ 参与算法多选 + 命名方案。
 // 文本/文件两套配置各存各的（弹窗内切页签）。配置存 localStorage，回首页沿用上次。
 // 强度档决定：参与哪些 op（allowOps 白名单）+ 层数/暴力/参数网格/时间预算，见 core/decodeProfile.js。
 // 配置形状 = 双作用域 { text:{level,customIds}, file:{level,customIds} }（与弹窗契约一致）。
 // 首页文本解码用 .text；拖入文件走 .file。两套各自持久化（localStorage，见 decodeProfile）。
  if (state.homeStrength === undefined) {
    state.homeStrength = loadLastConfig("text") || { level: "normal", customIds: [] };
  }
  const strengthBtn = el("button", { class: "act-btn magic-strength-btn", type: "button" },
    msym("tune"), el("span", { class: "magic-strength-text" }, ""));
  const syncStrengthBtn = () => {
    const cfg = state.homeStrength || { level: "normal", customIds: [] };
    const lvName = t("ui.ds.level." + (cfg.level || "normal"));
    const n = (cfg.customIds || []).length;
    strengthBtn.querySelector(".magic-strength-text").textContent =
      t("ui.home.strengthBtn") + "：" + lvName + (cfg.level === "custom" ? `(${n})` : "");
  };
  syncStrengthBtn();
  strengthBtn.addEventListener("click", () => {
    openDecodeStrength({
      cfg: { text: state.homeStrength },    // 弹窗仍接受 text 键名（兼容旧形状的 src = cfg.text）
      onApply: (cfg) => {
        state.homeStrength = cfg;            // cfg 现在是 {level, customIds} 单层
        saveLastConfig(cfg, "text");
        syncStrengthBtn();
      },
    });
  });
  const runBtn = el("button", { class: "act-btn primary magic-run" },
    msym("bolt"), el("span", {}, t("ui.home.runBtn")));
  const toolbar = el("div", { class: "magic-toolbar" },
 // 第一行：目标特征
    el("div", { class: "magic-row" },
      el("label", { class: "magic-crib-label" }, t("ui.home.cribLabel"), cribInput),
    ),
 // 第二行：密钥
    el("div", { class: "magic-row" },
      el("label", { class: "magic-crib-label" }, t("ui.home.keyLabel"), keyInput),
    ),
 // 第三行：解码强度 + 一键解码按钮
    el("div", { class: "magic-row magic-row-actions" },
      strengthBtn,
      runBtn,
    ),
  );

 // 单一输入框：输入 = 拖放。粘贴文本 → Magic 解码；拖入文件 → 文本读内容解码，二进制跑 analyzeFile。
  const input = ioArea({
    class: "io-area home-input", placeholder: t("ui.home.placeholder"),
  });
  input.value = state.homeInput || "";              // 恢复上次输入，切菜单再回来进度不丢
  const fileReport = el("div", { class: "file-report" });
  const outWrap = el("div", { class: "onekey-out" });
 // 超长横幅放在输入框「上面」（原在 outWrap 里=输入框下方，看不见）。独立容器，插在 input 前。
  const topBanner = el("div", { class: "onekey-topbanner" });

 // 解码只由「点按钮」触发（force=true，绕过长度上限）。
 // 逐字输入不再自动解码——magicDecode + exhaustiveDecode 每次击键同步跑会逐字卡顿（恒烈反馈）。
 // 打字/改 crib/切开关只存 state，不解码；要出结果点「一键解码」按钮。
 // 文本解码取 .text 档（拖入文件的路径另取 .file 档，见 drop 处理）。
  const forceTrigger = () => { runOneKey(input.value, outWrap, cribInput.value.trim(), state.homeStrength, true, topBanner, keyInput.value.trim(), runBtn); };
  input.addEventListener("input", () => { state.homeInput = input.value; });
  cribInput.addEventListener("input", () => { state.homeCrib = cribInput.value; });
  keyInput.addEventListener("input", () => { state.homeKey = keyInput.value; });
 // 一键解码按钮 = 唯一解码入口。有输入才跑，空则聚焦回输入框。
  runBtn.addEventListener("click", () => { if (input.value.trim()) forceTrigger(); else input.focus(); });
 // 回车（非 Shift）也触发解码，键盘流用户方便。
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (input.value.trim()) forceTrigger(); }
  });

 // 回到首页时若有上次解码结果的输入，恢复渲染一次（不丢上次分析；一次性非逐字，不卡）。
  if ((state.homeInput || "").trim()) setTimeout(forceTrigger, 0);

 // 同一框接收拖放：文本文件读进框跑解码，二进制文件跑文件分析
  input.addEventListener("dragover", (e) => { e.preventDefault(); input.classList.add("dragover"); });
  input.addEventListener("dragleave", () => input.classList.remove("dragover"));
  input.addEventListener("drop", async (e) => {
    e.preventDefault();
    input.classList.remove("dragover");
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (!f) return;
 // 读文件前先清空输入框 + 缓存 + 旧文件报告 + 旧解码卡片 + 旧横幅。
 // 否则框里已有文本时再拖文件，会「旧文本 + 新文件内容」各跑一遍 → 解码两次；
 // 且上一轮 outWrap 里的解码卡片不清会残留在本轮文件卡片下方（fileReport 在 outWrap 上方）。
    input.value = "";
    state.homeInput = "";
    fileReport.innerHTML = "";
    outWrap.innerHTML = "";
    if (topBanner) topBanner.innerHTML = "";
 // 令牌 +1：作废上一轮 runOneKey 的过期异步（穷举/magic 回来的迟到结果不再往 outWrap 写）。
    runOneKey._token = (runOneKey._token || 0) + 1;
    const buf = await f.arrayBuffer();
    const bytes = new Uint8Array(buf);
 // 判定文本 vs 二进制：改用「UTF-8 能否无损解码」而非高位字节占比。
 // 旧法 high/n<0.30 会把中文 UTF-8 文本（高位占比远超 30%）误判成二进制转 hex。
    if (isTextFile(bytes, f.name)) {
      input.value = new TextDecoder("utf-8").decode(bytes);
      state.homeInput = input.value;
      forceTrigger();   // 拖入文本文件 = 明确意图，直接解码一次（非逐字，不卡）
    } else {
      await handleFile(f, fileReport);
    }
  });

 // 首页一把梭输入框接通用编辑框工具条（粘贴/清空/复制/全选/导出/字号 + Ctrl+A/S）。
 // onChange 只存 state 不自动解码——解码统一由「一键解码」按钮触发（与逐字输入一致，不卡）。
  const homeToolbar = attachEditorToolbar(input, {
    onChange: () => { state.homeInput = input.value; },
    exportName: "onekey-input.txt",
  });

  wrap.append(toolbar, topBanner, homeToolbar, input, fileReport, outWrap);
  $ws.append(wrap);
  input.focus();
}

// 看门狗软死线（毫秒）：到点先渲染已得结果 + 倒计时读到此值，之后 Worker 后台继续。
const SOFT_DEADLINE_MS = 5000;

// MT72：收集「启用了自定义实现」的 opId 集合（magic / 穷举排除用）。
// 直接问 store 要（一次读取），不逐个 op 查 localStorage——608 个 op 那样查会拖慢每次一键解码。
function activeCustomImplIds() {
  return listEnabledOpIds();
}

// strengthCfg = { level, customIds }（来自「解码强度」弹窗）。resolveDecodeConfig 解析成
// allowOps 白名单 + 层数/暴力/参数网格/时间预算，替代原先的 intensive/multiLayer 两个布尔。
async function runOneKey(text, outWrap, crib, strengthCfg, force = false, topBanner = null, key = "", runBtn = null) {
  outWrap.innerHTML = "";
  if (topBanner) topBanner.innerHTML = "";   // 横幅容器每次运行先清空
  const q = text.trim();          // 注意：不要用 t，会遮蔽 i18n 的 t()
  if (!q) return;
 // 超 200 字符不自动解码（防爆），显示提示 + 手动触发按钮，避免用户以为坏了
  const ONEKEY_MAX_AUTO = 200;
  if (!force && q.length > ONEKEY_MAX_AUTO) {
 // 超长不自动解码，只显示一条横幅提示（一键解码按钮已在工具栏，点它 force=true 手动跑）。
 // 横幅放输入框「上面」——写入 topBanner（在 input 前）而非 outWrap（在 input 下方）。
    (topBanner || outWrap).append(el("div", { class: "onekey-banner" },
      msym("info"),
      el("div", { class: "onekey-banner-text" },
        el("span", {}, t("ui.home.tooLong", q.length, ONEKEY_MAX_AUTO)),
        el("span", { class: "onekey-banner-hint" }, t("ui.home.tooLongHint")),
      ),
    ));
    return;
  }
 // 本次运行令牌：输入变化快时丢弃过期结果，避免异步竞态覆盖
  const token = (runOneKey._token = (runOneKey._token || 0) + 1);

 // 强度档（decodeProfile.resolveDecodeConfig）产出层数/暴力/参数网格/时间预算 + op 白名单。
 // 提前解析：倒计时读秒要用档内软死线（fast 0.8s…max 8s），不能再写死 5s 否则读秒与实际不符。
  const resolved = resolveDecodeConfig(
    strengthCfg && strengthCfg.level ? strengthCfg : { level: "normal", scope: "text", customIds: [] }
  );
  const softMs = resolved.magic.softDeadlineMs || SOFT_DEADLINE_MS;

 // 看门狗倒计时（恒烈需求）：一键解码按钮左边显示读秒，软死线到点先渲染已得结果、
 // 后台继续；出最终结果 / 被新输入接管则清除。runBtn 由 renderHome 传入（可空，如拖文件路径）。
  let countdownTimer = null;
  const clearCountdown = () => {
    if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
    if (runBtn && runBtn._cd) { runBtn._cd.remove(); runBtn._cd = null; }
  };
  const startCountdown = () => {
    if (!runBtn) return;
    clearCountdown();
    const secs = Math.max(1, Math.ceil(softMs / 1000));
    let left = secs;
    const cd = el("span", { class: "magic-countdown" }, t("ui.home.countdown", left));
    runBtn._cd = cd;
    runBtn.parentNode && runBtn.parentNode.insertBefore(cd, runBtn);
    countdownTimer = setInterval(() => {
      left -= 1;
      if (left <= 0) {
 // 软死线到 → 文案转「后台继续」，不再读秒（部分结果已由 onPartial 渲染）。
        cd.textContent = t("ui.home.countdownBg");
        clearInterval(countdownTimer); countdownTimer = null;
      } else {
        cd.textContent = t("ui.home.countdown", left);
      }
    }, 1000);
  };

 // Magic 智能识别（真多线程 magicClient）：Worker 跑，主线程零阻塞（倒计时流畅）。
 // 单层默认覆盖全部编解码 op（含花式/古典）+ 综合分排序；multiLayer→maxDepth 3 多层链式（≤3）。
 // key（工具栏密钥框）→ 带密钥加解密 op（AES/DES/RC4/XOR/vigenere… + CTF 默认参数）参与。
 // onPartial：软死线（5s）到点先渲染已得结果，Worker 后台继续，最终结果到再整体重渲染。
 // allowOps=null（最强档）表示不限制，等同旧行为。resolved 已在上方（倒计时要用软死线）解析。
  const opts = { ...resolved.magic };
  if (resolved.allowOps) opts.allowOps = Array.from(resolved.allowOps);  // Worker 需可结构化克隆
  opts.softDeadlineMs = softMs;
  if (crib) opts.crib = crib;
  if (key) opts.key = key;
 // MT72：用户启用了自定义实现的 op 不进一键解码（原版结果误导 + 不跑用户代码）
  const _ciIds = activeCustomImplIds();
  if (_ciIds.length) opts.excludeOps = _ciIds;
  opts.onPartial = (parts) => {
    if (token !== runOneKey._token) return;  // 已被新输入接管，弃
    renderMagicCands(outWrap, q, parts, crib);
  };

 // 立即画原始输入卡占位（不等解码/软死线）——否则慢输入下 outWrap 已清空、5s 内画面全空，
 // 用户以为坏了。解码有结果后 renderMagicCands 整体重渲染覆盖此占位（幂等）。
  appendRawCard(outWrap, q);

  startCountdown();
  let cands;
  try {
    cands = await runMagic(q, opts);
  } catch (e) {
 // { cancelled:true } = 被新输入 / 中断接管 → 静默退出，不渲染（新任务会自己渲染）。
    if (e && e.cancelled) { clearCountdown(); return; }
    cands = [];  // 真异常降级为空结果，走「无候选」提示
  }
  clearCountdown();
  if (token !== runOneKey._token) return;  // 已有更新的输入，弃

  renderMagicCands(outWrap, q, cands, crib);

 // 暴力爆破独立通道（decodeProfile 独立池勾选的 op）：主排序之外单独归组跑，
 // 结果追加在候选区末尾、不参与 magic 综合分排序。每个 op 30s 兜底超时。
  const bruteOps = (resolved && resolved.bruteOps) || [];
  if (bruteOps.length) {
    const results = [];
    for (const opId of bruteOps) {
      const bop = getOp(opId);
      if (!bop || typeof bop.run !== "function") continue;
      if (token !== runOneKey._token) return;  // 被新输入接管，弃未跑完的爆破
      try {
        const r = await Promise.race([
          Promise.resolve().then(() => bop.run(q, {})),
          new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 30000)),
        ]);
        results.push({ id: bop.id, name: bop.name || bop.id, output: String(r), timedOut: false });
      } catch (e) {
        results.push({ id: bop.id, name: bop.name || bop.id, output: String((e && e.message) || e), timedOut: String(e) === "Error: timeout" });
      }
    }
    if (token === runOneKey._token && results.length) renderBruteResults(outWrap, q, results);
  }
}

// 渲染暴力爆破结果（独立通道）：追加在魔法候选区末尾，单独一个折叠区。
// run 型 op 输出是报告文本（可能很长），每项截断到 1200 字符，完整内容可点开。
function renderBruteResults(outWrap, q, results) {
  const sec = el("details", { class: "onekey-brute" });
  sec.open = true;
  sec.append(el("summary", { class: "onekey-brute-sum" },
    msym("bolt"),
    el("span", {}, t("ui.home.bruteTitle", results.length)),
  ));
  const list = el("div", { class: "onekey-brute-list" });
  for (const r of results) {
    const body = r.timedOut ? t("ui.home.bruteTimeout") : (r.output.length > 1200 ? r.output.slice(0, 1200) + "…" : r.output);
    const item = el("details", { class: "onekey-brute-item" });
    item.append(el("summary", { class: "onekey-brute-item-sum" },
      el("span", { class: "onekey-brute-name" }, r.name),
      el("span", { class: "onekey-brute-id" }, r.id),
    ));
    item.append(el("pre", { class: "onekey-brute-out" }, body));
    list.append(item);
  }
  sec.append(list);
  outWrap.append(sec);
}

// 渲染 magic 候选（供 onPartial 部分结果 + 最终结果两处复用；每次全量重渲染 outWrap）。
// 幂等：先清空 outWrap 再画原始卡 + 摘要 + 分组卡，多次调用只是用更全的候选覆盖。
function renderMagicCands(outWrap, q, cands, crib) {
  outWrap.innerHTML = "";
 // 结果区置顶「原始输入」卡——原样展示用户输入，便于一眼比对原文与各解码结果。
 // 该卡不参与 crib 绿色高亮（即使含 flag 字样也不误标 crib-hit）。
  appendRawCard(outWrap, q);

  if (!cands || !cands.length) {
    outWrap.append(el("div", { class: "onekey-empty" },
      t("ui.home.empty"),
      el("div", { class: "onekey-hint" }, t("ui.home.emptyHint")),
    ));
    return;
  }

 // Leet 降权——leetSpeak 解码对纯字母原样透传（flag/ctf 等前缀不变）
 // 原文若已含 crib 特征，leet 候选会「原样带出 flag」被误判命中变绿。识别这种假命中：
 // 候选链含 leetSpeak 且命中 crib，同时原文本身也命中 crib（说明 flag 是原文自带
 // 非 leet 真解出）→ 撤销绿色高亮并降到候选列表末尾。
  let cribRe = null;
  if (crib) { try { cribRe = new RegExp(crib, "i"); } catch { cribRe = null; } }
  const rawMatchesCrib = cribRe ? cribRe.test(q) : false;
  for (const c of cands) {
    c._leetFalseHit = !!(cribRe && c.matchesCrib && rawMatchesCrib && c.chain.includes("leetSpeak"));
    c._cribHit = c.matchesCrib && !c._leetFalseHit;
  }
 // leet 假命中降到末尾，其余保持 magic 综合分原顺序（filter 保序）
  cands = [...cands.filter((c) => !c._leetFalseHit), ...cands.filter((c) => c._leetFalseHit)];

 // 「三元组摘要行」——取 magic 最优候选（leet 降权后 cands[0]）
 // 置顶一行紧凑展示 [解码N次] 明文 + 混合解码结果: 链路。chain 为空（原文即明文）不显示。
  if (cands.length && cands[0].chain.length > 0) {
    outWrap.append(renderSummaryCard(cands[0]));
  }

 // 爆破分支合并单卡片。magic 参数扫描候选（chain 单元素、形如 caesar(shift=3)）
 // 会为同一算法产出几十条分支——同 baseOpId 归到一张可折叠卡（全列，命中即展开）。
  const groups = groupSweepCands(cands);
  for (const g of groups) {
    if (g.items.length >= 2) outWrap.append(renderBruteGroupCard(g));
    else outWrap.append(renderCandCard(g.items[0]));
  }
}

// 把 magic 候选按「爆破基算法」分组。参数扫描候选 chain 是单元素、形如
// `caesar(shift=3)`（见 exhaustiveDecode.formatParamTag）——同一 baseOpId 的多条分支归一组。
// 普通候选（op id 无括号 / 多层链 / 合成 xor:K,rot:R）各自独立成组（items 长度 1），保持原样。
// 分组保序：以每个 base 首次出现位置为组序，组内保 magic 综合分原顺序（最优在前）。
function groupSweepCands(cands) {
  const order = [];
  const byBase = new Map();
  for (const c of cands) {
 // 仅单层链且形如 base(params) 的才算爆破分支；其余用唯一键各自独立成组
    const single = c.chain.length === 1 ? c.chain[0] : null;
    const m = single && /^([^()]+)\((.*)\)$/.exec(single);
 // xor:K / rot:R 暴力候选（恒烈需求2）：单层合成链，255 个 key + 7 个 rot 全归一张
 // 「暴力尝试」卡，不再各占一行刷屏。base 记 "xor"/"rot"（去掉冒号后数字）→ 同前缀归一组。
    const brute = single && /^(xor|rot):/.test(single) ? single.split(":")[0] : null;
    let groupKey, base;
    if (m) { groupKey = "sweep:" + m[1]; base = m[1]; }
    else if (brute) { groupKey = "brute:" + brute; base = brute; }
    else { groupKey = "solo:" + (order.length + "|" + (single || c.chain.join(">"))); base = null; }
    if (!byBase.has(groupKey)) {
      const g = { base, items: [] };
      byBase.set(groupKey, g);
      order.push(g);
    }
    byBase.get(groupKey).items.push(c);
  }
  return order;
}

// 三元组摘要行——置顶展示 magic 最优候选。
// 格式：[解码N次] 明文（截断） + 混合解码结果: op1 › op2 › op3。
// 复用 onekey-card 样式，点击复制明文。crib 命中则高亮。
function renderSummaryCard(c) {
  const chainLabel = c.chain
    .map((id) => { const o = getOp(id); return o ? opNameBi(o) : id; })
    .join(" › ");
  const isLong = c.result.length > 500;
  const valEl = el("div", { class: "ok-val" }, isLong ? c.result.slice(0, 500) + " …" : c.result);
  const card = el("div",
    { class: "onekey-card onekey-summary" + (c._cribHit ? " crib-hit" : ""),
      title: t("ui.common.clickCopy"),
      onclick: () => { navigator.clipboard?.writeText(c.result); toast(t("ui.toast.copiedResult")); } },
    el("div", { class: "ok-name" },
      el("span", { class: "onekey-summary-tag" }, t("ui.home.summaryDecoded", c.chain.length)),
      el("span", { class: "onekey-summary-title" }, t("ui.home.summaryTitle"))),
    valEl,
    el("div", { class: "onekey-summary-chain" },
      el("span", { class: "onekey-summary-chain-label" }, t("ui.home.summaryChain") + ":"),
      el("span", { class: "onekey-summary-chain-vals" }, chainLabel)),
  );
  if (isLong) {
    const expandBtn = el("span", { class: "ok-expand" }, t("ui.common.expand", c.result.length));
    let expanded = false;
    expandBtn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      expanded = !expanded;
      if (expanded) { valEl.textContent = c.result; expandBtn.textContent = t("ui.common.collapse"); }
      else { valEl.textContent = c.result.slice(0, 500) + " …"; expandBtn.textContent = t("ui.common.expand", c.result.length); }
    });
    card.append(expandBtn);
  }
  return card;
}

// 单条候选卡（原 for 循环体抽出，行为不变）。
function renderCandCard(c) {
  const chainLabel = c.chain
    .map((id) => { const o = getOp(id); return o ? opNameBi(o) : id; })
    .join(" › ");
  const cribTag = c._cribHit ? " ●" : "";
  const isLong = c.result.length > 500;
  const valEl = el("div", { class: "ok-val" }, isLong ? c.result.slice(0, 500) + " …" : c.result);
  const card = el("div",
    { class: "onekey-card" + (c._cribHit ? " crib-hit" : ""),
      title: t("ui.common.clickCopy"),
      onclick: () => { navigator.clipboard?.writeText(c.result); toast(t("ui.toast.copiedResult")); } },
    el("div", { class: "ok-name" }, `${chainLabel}　·　${t("ui.home.confidence")} ${(c.confidence * 100).toFixed(0)}%${cribTag}`),
    valEl,
  );
  if (isLong) {
    const expandBtn = el("span", { class: "ok-expand" }, t("ui.common.expand", c.result.length));
    let expanded = false;
    expandBtn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      expanded = !expanded;
      if (expanded) { valEl.textContent = c.result; expandBtn.textContent = t("ui.common.collapse"); }
      else { valEl.textContent = c.result.slice(0, 500) + " …"; expandBtn.textContent = t("ui.common.expand", c.result.length); }
    });
    card.append(expandBtn);
  }
  return card;
}

// 爆破分组卡——同算法多参数分支收进一张 <details>。头显示算法名 + 分支数 + 最优分支
// 展开见其余分支。任一分支 crib 命中则整卡高亮。每条分支点击复制自己的结果。
function renderBruteGroupCard(g) {
 // xor/rot 暴力组用专属标签（不走 getOp——"xor" 会显示成普通「异或」op，语义是单字节爆破）。
  const BRUTE_LABEL = { xor: "XOR 单字节爆破", rot: "位循环移位爆破" };
  const op = g.base && !BRUTE_LABEL[g.base] ? getOp(g.base) : null;
  const baseName = BRUTE_LABEL[g.base] || (op ? opNameBi(op) : (g.base || ""));
  const anyCrib = g.items.some((c) => c._cribHit);
  const best = g.items[0]; // magic 综合分已排序，首条为最优

  const box = el("details", { class: "onekey-card onekey-brute" + (anyCrib ? " crib-hit" : ""), open: anyCrib ? "" : null });
 // 分支参数标签：从 base(params) 里取括号内内容
  const paramOf = (c) => {
    const s = c.chain[0] || "";
    const m = /^[^()]+\((.*)\)$/.exec(s);
    if (m) return m[1];
    const b = /^(xor|rot):(.+)$/.exec(s);   // xor:66 / rot:3 暴力候选：显示 key/位数
    if (b) return b[1] + "=" + b[2];
    return "";
  };
  const summary = el("summary", { class: "ok-name onekey-brute-head" },
    el("span", {}, t("ui.home.bruteGroup", baseName, g.items.length)),
    el("span", { class: "onekey-brute-best" },
      `${t("ui.home.bruteBest")}: ${paramOf(best)}　·　${t("ui.home.confidence")} ${(best.confidence * 100).toFixed(0)}%${best._cribHit ? " ●" : ""}`),
  );
  box.append(summary);

  for (const c of g.items) {
    const isLong = c.result.length > 500;
    const valEl = el("div", { class: "ok-val" }, isLong ? c.result.slice(0, 500) + " …" : c.result);
    const branch = el("div",
      { class: "onekey-brute-branch" + (c._cribHit ? " crib-hit" : ""),
        title: t("ui.common.clickCopy"),
        onclick: (ev) => { ev.stopPropagation(); navigator.clipboard?.writeText(c.result); toast(t("ui.toast.copiedResult")); } },
      el("div", { class: "onekey-brute-param" },
        `${paramOf(c)}　·　${(c.confidence * 100).toFixed(0)}%${c._cribHit ? " ●" : ""}`),
      valEl,
    );
    if (isLong) {
      const expandBtn = el("span", { class: "ok-expand" }, t("ui.common.expand", c.result.length));
      let expanded = false;
      expandBtn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        expanded = !expanded;
        if (expanded) { valEl.textContent = c.result; expandBtn.textContent = t("ui.common.collapse"); }
        else { valEl.textContent = c.result.slice(0, 500) + " …"; expandBtn.textContent = t("ui.common.expand", c.result.length); }
      });
      branch.append(expandBtn);
    }
    box.append(branch);
  }
  return box;
}

// 原始输入卡——置顶展示用户原文，明确标注「原始输入」。不做 crib 绿色高亮
// 即便原文含 flag 字样也不标 crib-hit，避免用户把原文自带的 flag 误当成解码结果。
function appendRawCard(outWrap, raw) {
  const isLong = raw.length > 500;
  const valEl = el("div", { class: "ok-val" }, isLong ? raw.slice(0, 500) + " …" : raw);
  const card = el("div",
    { class: "onekey-card onekey-raw",
      title: t("ui.common.clickCopy"),
      onclick: () => { navigator.clipboard?.writeText(raw); toast(t("ui.toast.copiedResult")); } },
    el("div", { class: "ok-name" }, t("ui.home.rawCard")),
    valEl,
  );
  if (isLong) {
    const expandBtn = el("span", { class: "ok-expand" }, t("ui.common.expand", raw.length));
    let expanded = false;
    expandBtn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      expanded = !expanded;
      if (expanded) { valEl.textContent = raw; expandBtn.textContent = t("ui.common.collapse"); }
      else { valEl.textContent = raw.slice(0, 500) + " …"; expandBtn.textContent = t("ui.common.expand", raw.length); }
    });
    card.append(expandBtn);
  }
 // 编辑框智能——原文卡检测不可见/零宽字符（CTF 零宽隐写常见考点）。
 // 仅在真检测到时才挂显形切换组件，避免干扰正常输入。
  try {
    const rep = invisibleReport(raw);
    if (rep.count > 0) {
 // host 拦截冒泡：组件内按钮点击不触发原文卡的复制 onclick。
      const invHost = el("div", { class: "onekey-raw-inv", onclick: (ev) => ev.stopPropagation() });
      card.append(invHost);
      invisibleToggle(invHost, raw);
    }
  } catch { /* 检测失败不影响原文卡 */ }
  outWrap.append(card);
}

// 穷举追加区——首页「一把梭」结果后追加全解（所有解码器全跑全列）。
// 复用 core/exhaustiveDecode.js。默认只列有变化项（onlyChanged），按分类分组、flag 三档高亮。
// 整块折叠进 <details>，默认展开；异步结果回来校验 token（与 runOneKey 同令牌）弃过期。
async function appendExhaustSection(outWrap, q, crib, token) {
 // 穷举全解跑前先挂进度条（分批执行 + onProgress 驱动）。大输入时穷举 op 多
 // 耗时长，进度条给「在跑、跑到哪」的反馈。
 // 进度条不直接 append 到 outWrap 末尾（会被上方原始卡+magic候选卡挤到整个输出流最底）
 // 改为先建穷举区容器 box、把进度条放在区头部（summary 之后），使进度条出现在穷举结果区顶部。
 // 结果落在同一 box 内；异常/过期/空结果则移除 box。
  const box = el("details", { class: "onekey-exhaust", open: "" });
  const summary = el("summary", { class: "onekey-exhaust-head" }, t("ui.home.exhaustTitle"));
  box.append(summary);
  const prog = el("div", { class: "onekey-progress" },
    el("div", { class: "onekey-progress-label" }, msym("bolt"), el("span", { class: "onekey-progress-text" }, t("ui.home.exhaustRunning", 0))),
    el("div", { class: "onekey-progress-bar" }, el("div", { class: "onekey-progress-fill" })),
  );
  const fill = prog.querySelector(".onekey-progress-fill");
  const ptext = prog.querySelector(".onekey-progress-text");
  box.append(prog);                            // 进度条落在穷举区头部（summary 之后）
  outWrap.append(box);                          // 穷举区整体追加到输出流（magic 候选之后）

  const onProgress = (done, total) => {
    if (token !== runOneKey._token) return;    // 过期运行不再更新 UI
    const pct = total ? Math.round((done / total) * 100) : 0;
    if (fill) fill.style.width = pct + "%";
    if (ptext) ptext.textContent = t("ui.home.exhaustRunning", pct);
  };

  let r;
  const _exIds = activeCustomImplIds();
  try { r = await exhaustiveDecode(q, { crib: crib || undefined, onlyChanged: true, onProgress, ...(_exIds.length ? { excludeOps: _exIds } : {}) }); }
  catch { box.remove(); return; }
  prog.remove();                               // 跑完移除进度条，让位结果区
  if (token !== runOneKey._token) { box.remove(); return; }  // 输入已变，弃过期穷举区
  if (r.tooLong) {
    box.append(el("div", { class: "onekey-hint" }, t("ui.exhaust.tooLong", r.maxInput)));
    return;
  }
  if (!r.total) { box.remove(); return; }       // 无变化项，撤掉空区

  summary.append(el("span", { class: "onekey-exhaust-stat" }, t("ui.exhaust.stat", r.total, r.hits)));
  for (const g of r.groups) {
    const catBox = el("div", { class: "exhaust-cat" });
    catBox.append(el("div", { class: "exhaust-cat-head" },
      el("span", { class: "exhaust-cat-name" }, catNameById(g.cat)),
      el("span", { class: "exhaust-cat-count" }, String(g.items.length)),
    ));
    for (const it of g.items) {
      const hitCls = it.isFlagFormat ? " flag-format" : ((it.flagHit || it.matchesCrib) ? " flag-hit" : "");
      const row = el("div", { class: "exhaust-row" + (it.ok ? "" : " err") + hitCls });
      const nameEl = el("span", { class: "exhaust-op" }, opNameBi(getOp(it.opId) || { id: it.opId, name: it.opId }));
      let valEl;
      if (!it.ok) {
        valEl = el("span", { class: "exhaust-val exhaust-err-val" }, "✗ " + (it.error || ""));
      } else {
        const full = it.result || "";
        const shown = full.length > 300 ? full.slice(0, 300) + " …" : full;
        valEl = el("span", { class: "exhaust-val" + (it.printable < 0.5 ? " garbage" : "") }, shown);
        row.setAttribute("title", t("ui.common.clickCopy"));
        row.addEventListener("click", () => { navigator.clipboard?.writeText(full); toast(t("ui.toast.copiedResult")); });
      }
      row.append(nameEl, el("span", { class: "exhaust-sep" }, ":"), valEl);
      catBox.append(row);
    }
    box.append(catBox);
  }
}

// 判定字节流是文本还是二进制。
// 旧法「高位字节占比 < 30%」会把中文 UTF-8 文本误判成二进制（中文每字 3 字节全高位）。
// 新法：① 已知二进制 magic（图像/压缩/可执行等）直接判二进制；② 含 NUL 判二进制；
// ③ 用 fatal TextDecoder 试解 UTF-8，能无损解码即文本（涵盖全部中文/日文/emoji）。
function isTextFile(bytes, name = "") {
  if (!bytes || bytes.length === 0) return true;
  const n = Math.min(bytes.length, 8192);
 // ① 已知二进制文件头（magic）——图像/音频/压缩/PDF/可执行，拖入应走文件分析而非塞进框。
  const b = bytes;
  const magic4 = (a, c, d, e) => b[0] === a && b[1] === c && b[2] === d && b[3] === e;
  if (
    magic4(0x89, 0x50, 0x4e, 0x47) ||          // PNG
    (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) || // JPG
    magic4(0x47, 0x49, 0x46, 0x38) ||          // GIF8
    (b[0] === 0x42 && b[1] === 0x4d) ||        // BMP
    magic4(0x52, 0x49, 0x46, 0x46) ||          // RIFF (wav/webp/avi)
    magic4(0x50, 0x4b, 0x03, 0x04) || magic4(0x50, 0x4b, 0x05, 0x06) || // ZIP/docx/…
    magic4(0x52, 0x61, 0x72, 0x21) ||          // RAR
    magic4(0x7f, 0x45, 0x4c, 0x46) ||          // ELF
    (b[0] === 0x4d && b[1] === 0x5a) ||        // PE (MZ)
    (b[0] === 0x1f && b[1] === 0x8b) ||        // GZIP
    magic4(0x25, 0x50, 0x44, 0x46) ||          // PDF
    magic4(0x37, 0x7a, 0xbc, 0xaf) ||          // 7z
    magic4(0x49, 0x44, 0x33, 0x00) || (b[0] === 0xff && b[1] === 0xfb) // MP3
  ) return false;
 // ② NUL 字节 → 二进制。
  for (let i = 0; i < n; i++) if (bytes[i] === 0) return false;
 // ③ UTF-8 无损解码检验（fatal 模式，非法字节抛错 → 二进制）。
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, n));
    return true;
  } catch {
 // 非 UTF-8：可能是 latin1/GBK 等单字节文本。回退到「可打印占比」判定。
    let printable = 0;
    for (let i = 0; i < n; i++) {
      const c = bytes[i];
      if (c === 9 || c === 10 || c === 13 || (c >= 32 && c < 127)) printable++;
    }
    return printable / n > 0.85;
  }
}

// ---- 文件分析报告渲染 ----
async function handleFile(file, outWrap) {
  outWrap.innerHTML = "";
  outWrap.append(el("div", { class: "file-report-loading" }, t("ui.file.loading", file.name)));
  try {
    const buf = await file.arrayBuffer();
    const bytes = new Uint8Array(buf);
    const report = analyzeFile(bytes, file.name);
 // 补充分析器（独立模块，按类型分派）：图片(PNG/BMP)像素级 / 音频(WAV)频谱级。
 // 各返回 { sections }，追加到主报告末尾（补充信息，排主报告 alert>warn>info 之后合理）。
    try {
      const ext = (report.ext || "").toLowerCase();
      const mime = report.detected || "";
      let extra = null;
      if (ext === "png" || ext === "bmp" || ext === "jpg" || ext === "jpeg" || ext === "gif" || /png|bmp|jpe?g|gif/i.test(mime)) {
        extra = await analyzeImageAsync(bytes, file.name, report.detected);
      } else if (ext === "wav" || /wav|audio/i.test(mime)) {
        extra = analyzeAudio(bytes, file.name, report.detected);
      } else if (ext === "7z" || bytes.length >= 6 && bytes[0] === 0x37 && bytes[1] === 0x7a && bytes[2] === 0xbc && bytes[3] === 0xaf && bytes[4] === 0x27 && bytes[5] === 0x1c) {
        extra = await analyze7zFile(bytes);
      } else if (ext === "pyc" || ext === "exe" || (bytes.length >= 2 && bytes[0] === 0x4d && bytes[1] === 0x5a)) {
 // pyc/exe 自动反编（本地桥，仅 Windows + 需起 bridge.py）。
 // 桥不可用 / 非 Windows / 非 PyInstaller exe → 如实展示提示，不阻断主报告。
 // body 放完整反编源码（formatResult 已含多 pyc 汇总 + 元信息头），无需额外 view action。
        const kind = (ext === "pyc") ? "pyc" : (ext === "exe" ? "exe" : "auto");
        const res = await decompileBytes(bytes, file.name, kind);
        const text = formatDecompileResult(res, file.name);
        extra = { sections: [{
          id: "decompile", title: "pyc/exe 反编（本地桥）",
          level: res && res.ok ? "info" : "warn",
          icon: "code",
          body: text,
        }] };
      }
      if (extra && Array.isArray(extra.sections) && extra.sections.length) {
        report.sections.push(...extra.sections);
      }
    } catch { /* 补充分析失败不阻断主报告 */ }
    renderFileReport(outWrap, report);
  } catch (e) {
    outWrap.innerHTML = "";
    outWrap.append(el("div", { class: "file-report-error" }, t("ui.file.fail", e && e.message ? e.message : String(e))));
  }
}

function renderFileReport(outWrap, r) {
  outWrap.innerHTML = "";
  const sizeStr = r.size > 1024 ? (r.size / 1024).toFixed(1) + " KB" : r.size + " B";
 // 报告头重排——文件名放大置顶为主标题，类型/大小作副信息行。
  outWrap.append(el("div", { class: "file-report-header" },
    msym("attach_file", "file-report-glyph"),
    el("div", { class: "file-report-headmain" },
      el("div", { class: "file-name" }, r.name || t("ui.file.unnamed")),
      el("div", { class: "file-report-meta" },
        r.detected ? el("span", { class: "file-type" }, r.detected) : null,
        el("span", { class: "file-size" }, sizeStr),
        r.ext ? el("span", { class: "file-ext" }, "." + r.ext) : null,
      ),
    ),
  ));
 // sections 已由 fileAnalysis 按 alert>warn>info 排好序，最重要的在最上。
 // 每张卡带 section.icon（风格统一的 Material 小图标），标题前注入，颜色随 level 区分。
  for (const s of r.sections) {
    const hasActions = Array.isArray(s.actions) && s.actions.length > 0;
 // view 动作：整卡可双击查看（取第一个 view 动作的内容）；卡片加提示条与手型光标。
    const viewAct = hasActions ? s.actions.find((a) => a.type === "view") : null;
    const card = el("div", { class: "file-section " + s.level + (viewAct ? " file-section-viewable" : "") },
      el("div", { class: "file-section-title" },
        s.icon ? msym(s.icon, "file-section-glyph") : null,
        el("span", {}, s.title),
      ),
      el("div", { class: "file-section-body" }, s.body),
    );
    if (hasActions) {
 // 下载动作按钮行（view 动作不出按钮，走双击）。
      const dlActs = s.actions.filter((a) => a.type === "download");
      if (dlActs.length) {
        const bar = el("div", { class: "file-section-actions" });
        for (const a of dlActs) {
          bar.append(el("button", {
            class: "file-section-act",
            onclick: (e) => { e.stopPropagation(); downloadBytes(a.bytes, a.filename, a.mime); },
          }, msym("download", "file-act-glyph"), el("span", {}, a.label)));
        }
        card.append(bar);
      }
      if (viewAct) {
        card.append(el("div", { class: "file-section-viewhint" },
          msym("open_in_full", "file-view-glyph"),
          el("span", {}, t("ui.file.dblToView")),
        ));
        card.addEventListener("dblclick", () => openSectionView(s.title, viewAct));
      }
    }
    outWrap.append(card);
  }
}

// 触发浏览器下载：bytes(Uint8Array/number[]) → Blob → a[download]（本地生成，零外发）。
function downloadBytes(bytes, filename, mime) {
  const u8a = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  const blob = new Blob([u8a], { type: mime || "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename || "download.bin";
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// section view 动作：只读查看窗（文本 pre / 图片 img），复用 expandableInput 注入的 .exp-* modal 样式。
function openSectionView(title, act) {
  ensureExpStyles(); // 文件报告页可能从未实例化过可展开输入框，样式表未注入 → 弹窗裸奔白底。此处兜底注入。
  const overlay = el("div", { class: "exp-overlay" });
  const dialog = el("div", { class: "exp-dialog", role: "dialog" });
  const head = el("div", { class: "exp-head" },
    el("div", { class: "exp-title" }, title || t("ui.file.viewTitle")),
    el("button", { type: "button", class: "exp-close", title: t("ui.expand.cancel"), onclick: close }, msym("close")),
  );
  let bodyEl;
  if (act.mime && /^image\//.test(act.mime) && act.bytes) {
    const u8a = act.bytes instanceof Uint8Array ? act.bytes : new Uint8Array(act.bytes);
    const url = URL.createObjectURL(new Blob([u8a], { type: act.mime }));
    bodyEl = el("div", { class: "exp-view exp-view-img" }, el("img", { src: url, alt: title || "" }));
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  } else {
    const text = act.text != null ? act.text
      : (act.bytes ? new TextDecoder("utf-8").decode(act.bytes instanceof Uint8Array ? act.bytes : new Uint8Array(act.bytes)) : "");
    bodyEl = el("pre", { class: "exp-view exp-view-text" }, text);
  }
  dialog.append(head, bodyEl);
  overlay.append(dialog);
  document.body.append(overlay);
  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    document.removeEventListener("keydown", onKey);
    overlay.classList.add("exp-closing");
    setTimeout(() => overlay.remove(), 175);
  }
  function onKey(e) { if (e.key === "Escape") { e.preventDefault(); close(); } }
  overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) close(); });
  document.addEventListener("keydown", onKey);
}

// dataURL → 字节 / MIME（出图类 op 下载复用）。
function dataUrlToBytes(url) {
  const comma = url.indexOf(",");
  const b64 = comma >= 0 ? url.slice(comma + 1) : url;
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function mimeOfDataUrl(url) {
  const m = /^data:([^;,]+)/.exec(url);
  return m ? m[1] : "image/png";
}

// 输出区图片渲染：扫描 op 输出文本里的 data:image/*;base64,...（出图类 op 约定：
// qrGen 二维码 / gifFrames 逐帧 / mcMap / bin2img / imgFft / spectrogram 等），
// 逐个渲染成可见缩略图 + 下载按钮，点缩略图走灯箱放大。无匹配则清空媒体区。
const OUT_IMG_RE = /data:image\/(?:png|jpe?g|gif|webp|bmp);base64,[A-Za-z0-9+/]+=*/g;
function renderOutMedia(container, text) {
  if (!container) return;
  container.innerHTML = "";
  if (!text) return;
  const urls = String(text).match(OUT_IMG_RE);
  if (!urls || !urls.length) return;
  const grid = el("div", { class: "io-out-media-grid", style: "display:flex;flex-wrap:wrap;gap:12px;margin-top:8px" });
  const multi = urls.length > 1;
  urls.forEach((url, i) => {
    const img = el("img", {
      class: "io-out-media-img", src: url, alt: "", loading: "lazy",
      style: "max-width:180px;max-height:180px;cursor:zoom-in;border-radius:6px;image-rendering:pixelated;background:#fff",
    });
    img.addEventListener("click", () => openImageLightbox(url, ""));
    const dl = el("button", {
      type: "button", class: "file-section-act",
      onclick: (e) => { e.stopPropagation(); downloadBytes(dataUrlToBytes(url), (state.opId || "image") + (multi ? "_" + (i + 1) : "") + ".png", mimeOfDataUrl(url)); },
    }, msym("download", "file-act-glyph"), el("span", {}, t("ui.op.export")));
    grid.append(el("figure", { class: "io-out-media-cell", style: "display:flex;flex-direction:column;gap:4px;align-items:center;margin:0" }, img, dl));
  });
  container.append(grid);
}

// 图片灯箱：全屏遮罩内居中大图，点击遮罩/图片或 Esc 关闭。
// 与 openSectionView 的小编辑弹窗分开——灯箱要尽量大 + 高保真渲染（不套 stego 的 pixelated）。
function openImageLightbox(url, alt) {
  const overlay = el("div", { class: "img-lightbox", role: "dialog", "aria-label": alt || "" });
  const img = el("img", { class: "img-lightbox-img", src: url, alt: alt || "" });
  const closeBtn = el("button", { type: "button", class: "img-lightbox-close", title: t("ui.expand.cancel"), onclick: close }, msym("close"));
  overlay.append(img, closeBtn);
  document.body.append(overlay);
  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    document.removeEventListener("keydown", onKey);
    overlay.classList.add("img-lightbox-closing");
    setTimeout(() => overlay.remove(), 175);
  }
  function onKey(e) { if (e.key === "Escape") { e.preventDefault(); close(); } }
  overlay.addEventListener("mousedown", () => close());
  document.addEventListener("keydown", onKey);
}

// 给任意 textarea 挂「拖入文件」能力（op 输入框继承首页智能框）：
// 文本文件 → 读内容进框（TextDecoder，对齐首页 isTextFile 判定，不再无脑转 hex）；
// 二进制文件 → 转 hex 进框作可见回退（op 场景多是对 hex 做转换）。
// 原始字节透传：无论文本/二进制都把真字节缓存到 ta._rawBytes（+ ta._rawFileName）
// 供需要原始字节的 op（如 PNG 解析）读取，避免只能拿到 hex 文本或被 UTF-8 解码破坏的字节。
// 载入后回调 onLoaded(bytes)（通常触发 convert，并把 bytes 一并透传）。
// 目前执行层（convert）尚无 bytes 契约（无 op 声明 acceptsBytes），此通道为预留；
// 用户手动编辑框内容即视为字节失效，清空缓存防止 op 读到过期字节。
// File → 字节进框（拖放 + 「选择文件」按钮共用）。acceptsBytes op 走 rawBytes 占位；
// 文本 TextDecoder 进框；二进制转 hex。载入后 onLoaded(bytes) 触发 convert。
async function loadFileIntoArea(ta, f, onLoaded) {
  if (!f) return;
  const bytes = new Uint8Array(await f.arrayBuffer());
 // 原始字节透传通道：文本/二进制都缓存，供吃 bytes 的 op 读取。
  ta._rawBytes = bytes;
  ta._rawFileName = f.name;
 // 分派：当前 op 声明 acceptsBytes（吃原始字节）→ 不转 hex，编辑框只显示占位提示
 // 真字节走 rawBytes 通道（修复「拖图片进框变一坨 hex」的痛点）。
 // 否则沿用文本/二进制判定：文本文件 TextDecoder 进框，二进制转 hex（hex-string op 需要）。
  const curOp = getOp(state.opId);
  if (curOp && curOp.acceptsBytes) {
    ta.value = t("ui.op.fileLoaded", f.name, humanSize(bytes.length));
    ta._isFilePlaceholder = true;
    toast(t("ui.op.droppedBytes", f.name));
  } else if (isTextFile(bytes, f.name)) {
 // 用 isTextFile（UTF-8 无损解码判定）替代高位字节占比法，避免中文 UTF-8 文本被误判成二进制转 hex。
    ta.value = new TextDecoder("utf-8").decode(bytes);
    ta._isFilePlaceholder = false;
    toast(t("ui.op.droppedText", f.name));
  } else {
    let hex = "";
    for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, "0");
    ta.value = hex;
    ta._isFilePlaceholder = false;
    toast(t("ui.op.droppedHex", f.name));
  }
 // input 监听会在 ta.value 赋值时把缓存清掉（contenteditable 赋值可能触发）
 // 故在回调前重新坐实缓存，确保 onLoaded 与后续 op 能拿到本次载入的真字节。
  ta._rawBytes = bytes;
  ta._rawFileName = f.name;
  if (onLoaded) onLoaded(bytes);
}

// 弹系统文件选取器，选中后走 loadFileIntoArea（不依赖拖放，覆盖「拖不进/远程桌面」场景）。
function pickFileIntoArea(ta, onLoaded) {
  const inp = document.createElement("input");
  inp.type = "file";
  inp.style.display = "none";
  inp.addEventListener("change", async () => {
    const f = inp.files && inp.files[0];
    if (f) await loadFileIntoArea(ta, f, onLoaded);
    inp.remove();
  });
  document.body.append(inp);
  inp.click();
}

function attachDropDecode(ta, onLoaded) {
  ta.addEventListener("dragover", (e) => { e.preventDefault(); ta.classList.add("dragover"); });
  ta.addEventListener("dragleave", () => ta.classList.remove("dragover"));
 // 手动编辑 → 原始字节缓存失效（拖入的文件字节已与框内文本脱钩），占位态也一并解除
  ta.addEventListener("input", () => { ta._rawBytes = null; ta._rawFileName = null; ta._isFilePlaceholder = false; });
  ta.addEventListener("drop", async (e) => {
    e.preventDefault();
    ta.classList.remove("dragover");
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) await loadFileIntoArea(ta, f, onLoaded);
  });
}

// ---- 单 op 操作面板 ----
function renderOp() {
  const op = getOp(state.opId);
  if (!op) return renderHome();
  if (op.id === "cryptoTryAll") return renderCryptoTryAll(op);

  const head = el("div", { class: "op-head" },
    el("div", { class: "op-title" }, msym(CATEGORIES.find((c) => c.id === op.cat)?.icon || "tag"),
      op.requiresBridge ? el("span", { class: "exe-badge" }, "EXE") : null, opName(op)),
    opDesc(op) ? el("div", { class: "op-desc" }, opDesc(op)) : null,
  );
  $ws.append(head);

 // exe 型 op（requiresBridge）：无编解码语义，点即启动本机 exe / 跑 CLI。
 // 不渲染输入/输出/转换，改为「启动」按钮 + 结果显示区。若有 params（CLI 型）仍渲染参数栏。
  if (op.requiresBridge) {
    renderExeOp(op);
    return;
  }

 // 方向切换（仅双向 op 显示）
  const isDual = op.encode && op.decode;
  if (isDual) {
    const seg = el("div", { class: "dir-seg" },
      el("button", { class: state.dir === "encode" ? "on" : "", onclick: () => { state.dir = "encode"; convert(); updateDirSeg(); } }, t("ui.op.encode")),
      el("button", { class: state.dir === "decode" ? "on" : "", onclick: () => { state.dir = "decode"; convert(); updateDirSeg(); } }, t("ui.op.decode")),
    );
    seg.id = "dirSeg";
    $ws.append(seg);
  }

 // 参数栏
  if (op.params.length) {
    const bar = el("div", { class: "op-params" });
    for (const d of op.params) bar.append(renderParam(op, d));
    $ws.append(bar);
  }

 // MT72：高级 · 自定义实现（默认关；勾上 = 用用户 JS 替换本 op 的 encode/decode）。
 // 自定义实现不参与 magic / 穷举（见 runOneKey 的 excludeOps），Worker 沙箱 + 超时执行。
 // op / dir 一并传进去：编辑器要拿它抽内置实现源码当编辑起点（MT86）。
  if (!op.requiresBridge && op.id !== "cryptoTryAll") {
    const ciRow = el("div", { class: "ci-anchor" });
    renderCustomToggle(ciRow, op.id, {
      op,
      dir: state.dir,
      onToggle: () => convert(),
      onTest: (code, cb) => {
        const inEl = document.getElementById("ioIn");
        const text = inEl ? inEl.value : "";
        const rb = inEl && inEl._rawBytes ? inEl._rawBytes : null;
        runCustomWithTimeout({ code, dir: state.dir, input: text, params: state.params, rawBytes: rb }).then(cb);
      },
    });
    $ws.append(ciRow);
  }

 // 纵向 IO：输入/输出上下堆叠，等宽撑满内容区。
 // IO 框可 resize:vertical（CSS）+ A-/A+ 调字号（会话态 state.ioFont）。
 // op 若声明 fields[] → 渲染多个带标签输入框，收集后按约定拼给 run/encode/decode。
  const hasFields = Array.isArray(op.fields) && op.fields.length > 0;
  const inArea = ioArea({ class: "io-area", placeholder: t("ui.op.inPlaceholder") });
  const outArea = ioArea({ class: "io-area", placeholder: t("ui.op.outPlaceholder"), readonly: true });
  inArea.id = "ioIn"; outArea.id = "ioOut";
 // 会话态字号（不持久化）
  inArea.style.fontSize = state.ioFont + "px";
  outArea.style.fontSize = state.ioFont + "px";
 // 多输入框容器：每个 field 一个带标签 textarea，id = fld_<key>
  const fieldAreas = [];
  if (hasFields) {
    for (const f of op.fields) {
      const ta = ioArea({
        class: "io-area io-field-area",
        placeholder: f.placeholder || "",
      });
      ta.id = "fld_" + f.key;
      ta.style.fontSize = state.ioFont + "px";
      ta.addEventListener("keydown", (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); convert(); }
      });
      fieldAreas.push(el("div", { class: "io-field" },
        el("label", { class: "io-field-label" }, f.label),
        ta,
      ));
    }
  }

 // 字号调节按钮（A- / A+），改所有 IO textarea 内联 font-size。
  const applyFont = () => {
    const px = state.ioFont + "px";
    document.querySelectorAll(".io-area").forEach((n) => { n.style.fontSize = px; });
  };
  const fontDec = toolBtn("text_decrease", t("ui.op.fontDec"), () => {
    state.ioFont = Math.max(11, state.ioFont - 1); applyFont();
  });
  const fontInc = toolBtn("text_increase", t("ui.op.fontInc"), () => {
    state.ioFont = Math.min(28, state.ioFont + 1); applyFont();
  });

 // 转换动作条：显式「转换/一键解码」按钮，不监听 input 实时跑。
  const actLabel = op.run ? t("ui.op.convert") : (isDual ? t("ui.op.convert") : t("ui.op.decode"));
  const runAct = el("button", { class: "act-btn primary" }, msym(isDual ? "sync_alt" : "bolt"), " " + actLabel);
  runAct.addEventListener("click", () => convert());
  const chainAct = el("button", { class: "act-btn", title: t("ui.op.chainToInput") },
    msym("swap_vert"), " " + t("ui.op.chainToInput"));
  chainAct.addEventListener("click", () => { inArea.value = outArea.value; convert(); });

 // 输入区主体：多字段模式渲染 fieldAreas，否则单 textarea。
  const inputBody = hasFields
    ? el("div", { class: "io-fields" }, ...fieldAreas)
    : inArea;
  const clearAll = () => {
    inArea.value = "";
    outArea.value = "";
    renderOutMedia(document.getElementById("ioOutMedia"), "");
    if (hasFields) fieldAreas.forEach((w) => { const ta = w.querySelector(".io-field-area"); if (ta) ta.value = ""; });
  };

  const io = el("div", { class: "io io-vert" },
 // 输入
    el("div", { class: "io-pane" },
      el("div", { class: "io-pane-head" },
        el("span", { class: "io-pane-title" }, t("ui.op.inTitle")),
        el("div", { class: "io-pane-tools" },
          fontDec, fontInc,
          hasFields ? null : toolBtn("content_paste", t("ui.op.paste"), async () => { try { inArea.value = await navigator.clipboard.readText(); } catch { toast(t("ui.toast.clipFail")); } }),
          hasFields ? null : toolBtn("cloud_upload", t("ui.op.pickFile"), () => pickFileIntoArea(inArea, () => convert())),
          hasFields ? null : toolBtn("select_all", t("ui.op.selectAll"), () => selectAllIO(inArea)),
          hasFields ? null : toolBtn("download", t("ui.op.export"), () => exportTextAsFile(inArea.value)),
          toolBtn("delete", t("ui.op.clear"), clearAll),
        ),
      ),
      inputBody,
    ),
 // 动作条（居中）
    el("div", { class: "io-actions" }, runAct, chainAct),
 // 输出
    el("div", { class: "io-pane" },
      el("div", { class: "io-pane-head" },
        el("span", { class: "io-pane-title" }, t("ui.op.outTitle")),
        el("div", { class: "io-pane-tools" },
          toolBtn("content_copy", t("ui.op.copy"), () => { navigator.clipboard?.writeText(outArea.value); toast(t("ui.toast.copied")); }),
          toolBtn("select_all", t("ui.op.selectAll"), () => selectAllIO(outArea)),
          toolBtn("download", t("ui.op.export"), () => exportTextAsFile(outArea.value)),
        ),
      ),
      outArea,
 // 出图类 op 的图片预览区（convert 检测输出中的 data:image URL 后填充，可预览+下载）。
      el("div", { class: "io-out-media", id: "ioOutMedia" }),
    ),
  );
  $ws.append(io);

 // 不做 input 实时转换（增删过程性能浪费）。Ctrl+Enter 快捷触发。
  inArea.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); convert(); }
  });
 // 编辑框记事本化——Ctrl+S 导出输入内容为 .txt（Ctrl+Z 撤销走 contenteditable 原生）。
  attachEditorShortcuts(inArea);
  attachEditorShortcuts(outArea);

 // 所有 op 输入框都继承首页智能框——无条件支持拖入文件（isTextFile 判定：文本读进框
 // 二进制才转 hex）。原先只在 !hasFields 时挂，导致带参 op（加密/编码带 key 的）拖文件无智能识别。
  attachDropDecode(inArea, () => convert());

 // 编辑框右键文本处理菜单（智能分段/删空格换行/大小写/反转/金额转中文…）。
 // op 框不走 editorToolbar，故在此直接挂 attachTextContextMenu。输入框可写（onChange 触发转换）
 // 输出框只读（菜单自动降级为复制/全选无损项），多字段模式每个 field 也挂。
  attachTextContextMenu(inArea, { onChange: () => convert() });
  attachTextContextMenu(outArea, { readonly: true });
  if (hasFields) {
    for (const w of fieldAreas) {
      const ta = w.querySelector(".io-field-area");
      if (ta) attachTextContextMenu(ta);
    }
  }

 // 科普卡（输出框下方）：这是什么 / 原理 / 用法 / 示例 / 公式 / 贴士
  renderEduCard(op.id);

  inArea.focus();
}

// ---- exe 型 op 渲染（requiresBridge）----
// GUI 型：无 params，点「启动」调 op.run 拉起本机 exe。
// CLI 型：有 params（含 stdin/文件 base64 等），点「启动」用当前参数跑一次，结果填结果区。
function renderExeOp(op) {
 // 参数栏（CLI 型可能有；GUI 型 params:[] 则不渲染）
  if (op.params && op.params.length) {
    const bar = el("div", { class: "op-params" });
    for (const d of op.params) bar.append(renderParam(op, d));
    $ws.append(bar);
  }

 // 结果显示区（只读，复用 io-area 样式）
  const resultArea = ioArea({ class: "io-area", placeholder: t("ui.op.launchResult"), readonly: true });
  resultArea.id = "ioOut"; // 复用 id，令 renderParam 里 convert() 调用不报错（exe 不实时转换，但参数改动会触发）
  resultArea.style.fontSize = state.ioFont + "px";

 // 启动按钮
  const launchBtn = el("button", { class: "act-btn primary" }, msym("terminal"), " " + t("ui.op.launch"));
  let running = false;
  launchBtn.addEventListener("click", async () => {
    if (running) return;
    running = true;
    launchBtn.disabled = true;
    const oldHtml = launchBtn.innerHTML;
    launchBtn.textContent = t("ui.op.launching");
    resultArea.classList.remove("error");
    resultArea.style.color = "";
    try {
      const out = await op.run("", state.params);
      resultArea.value = out;
    } catch (e) {
      resultArea.value = "✗ " + (e.message || t("ui.toast.convertFail"));
      resultArea.style.color = "var(--error)";
      resultArea.classList.add("error");
    } finally {
      running = false;
      launchBtn.disabled = false;
      launchBtn.innerHTML = oldHtml;
    }
  });

  const io = el("div", { class: "io io-vert" },
    el("div", { class: "io-actions" }, launchBtn),
    el("div", { class: "io-pane" },
      el("div", { class: "io-pane-head" },
        el("span", { class: "io-pane-title" }, t("ui.op.launchResult")),
        el("div", { class: "io-pane-tools" },
          toolBtn("content_copy", t("ui.op.copy"), () => { navigator.clipboard?.writeText(resultArea.value); toast(t("ui.toast.copied")); }),
        ),
      ),
      resultArea,
    ),
  );
  $ws.append(io);

 // 科普卡（若有）
  renderEduCard(op.id);
}

// ---- 科普卡渲染（输出框下方）----
// 数据来自 eduContent.js；公式用 KaTeX 懒加载（缺失自动降级为原始 TeX）。
function renderEduCard(opId) {
  const edu = getEdu(opId, getLocale());
  if (!edu) return;

  const card = el("div", { class: "edu-card" });
  card.append(el("div", { class: "edu-card-head" },
    msym("menu_book", "edu-glyph"),
    el("span", { class: "edu-card-title" }, t("ui.edu.title")),
  ));

 // 行内标记解析：$...$ → KaTeX 行内公式占位；`...` → 等宽小块。
 // 返回 DocumentFragment，供多段文本拼接。
  const parseInline = (text) => {
    const frag = document.createDocumentFragment();
 // 先按 $...$ 切，再对非公式段按 `...` 切
    const parts = String(text).split(/(\$[^$]+\$)/g);
    for (const p of parts) {
      if (!p) continue;
      if (p.startsWith("$") && p.endsWith("$") && p.length > 2) {
        const span = el("span", { class: "edu-math" });
        span.setAttribute("data-tex", p.slice(1, -1));
        frag.append(span);
      } else {
 // 处理反引号等宽块
        const segs = p.split(/(`[^`]+`)/g);
        for (const s of segs) {
          if (!s) continue;
          if (s.startsWith("`") && s.endsWith("`") && s.length > 2) {
            frag.append(el("code", { class: "edu-code" }, s.slice(1, -1)));
          } else if (/<[a-z][\s\S]*?>/i.test(s)) {
 // 科普数据是本地可信源，允许富文本标签（<b>/<i>/<sub>/<sup>/<table>/<ul> 等）
            const span = el("span", { class: "edu-rich" });
            span.innerHTML = s;
            frag.append(span);
          } else {
            frag.append(document.createTextNode(s));
          }
        }
      }
    }
    return frag;
  };

 // 多段文本（"\n\n" 分段）→ 若干 <p>
  const paras = (text) => {
    const wrap = el("div", { class: "edu-paras" });
    for (const seg of String(text).split(/\n\n+/)) {
 // 段落以块级 HTML 标签开头（table/ul/ol/pre/div/figure）→ 整段 innerHTML，不拆 <br>
      if (/^\s*<(table|ul|ol|pre|div|figure|blockquote)\b/i.test(seg)) {
        const block = el("div", { class: "edu-rich-block" });
        block.innerHTML = seg;
        wrap.append(block);
        continue;
      }
      const p = el("p", { class: "edu-para" });
 // 段内单换行保留为 <br>
      const lines = seg.split(/\n/);
      lines.forEach((ln, i) => {
        p.append(parseInline(ln));
        if (i < lines.length - 1) p.append(el("br"));
      });
      wrap.append(p);
    }
    return wrap;
  };

  const section = (labelKey, node) => {
    card.append(el("div", { class: "edu-sec" },
      el("div", { class: "edu-sec-label" }, t(labelKey)),
      node,
    ));
  };

  if (edu.what) section("ui.edu.what", paras(edu.what));
  if (edu.principle) section("ui.edu.principle", paras(edu.principle));

 // 对照图（图鉴里能被本 op 解析的编码，挂对照表图；纯装饰，缺图静默跳过）
  const eduImg = EDU_IMAGES[opId];
  if (eduImg) {
    const imgs = Array.isArray(eduImg) ? eduImg : [eduImg];
    const gal = el("div", { class: "edu-imgs" });
    for (const im of imgs) {
      const fig = el("figure", { class: "edu-img-fig" });
      const img = el("img", {
        class: "edu-img", src: im.src, alt: im.cap || "", loading: "lazy",
      });
      img.addEventListener("error", () => fig.remove());
      fig.append(img);
      if (im.cap) fig.append(el("figcaption", { class: "edu-img-cap" }, im.cap));
      gal.append(fig);
    }
    section("ui.edu.chart", gal);
  }

 // 独立公式（display）
  if (Array.isArray(edu.formulas) && edu.formulas.length) {
    const fwrap = el("div", { class: "edu-formulas" });
    for (const f of edu.formulas) {
      const row = el("div", { class: "edu-formula-row" });
      const m = el("div", { class: "edu-math edu-math-block" });
      m.setAttribute("data-tex", f.tex);
      m.setAttribute("data-display", "1");
      row.append(m);
      if (f.caption) row.append(el("div", { class: "edu-formula-cap" }, f.caption));
      fwrap.append(row);
    }
    section("ui.edu.formula", fwrap);
  }

  if (edu.usage) section("ui.edu.usage", paras(edu.usage));

 // 示例表
  if (Array.isArray(edu.examples) && edu.examples.length) {
    const exWrap = el("div", { class: "edu-examples" });
    for (const ex of edu.examples) {
      const row = el("div", { class: "edu-example" });
      row.append(
        el("div", { class: "edu-ex-io" },
          el("span", { class: "edu-ex-tag" }, t("ui.edu.exIn")),
          el("code", { class: "edu-ex-val" }, ex.in),
        ),
      );
      if (ex.param) {
        row.append(el("div", { class: "edu-ex-io" },
          el("span", { class: "edu-ex-tag" }, t("ui.edu.exParam")),
          el("code", { class: "edu-ex-val" }, ex.param),
        ));
      }
      row.append(
        el("div", { class: "edu-ex-io" },
          el("span", { class: "edu-ex-tag edu-ex-tag-out" }, t("ui.edu.exOut")),
          el("code", { class: "edu-ex-val edu-ex-val-out" }, ex.out),
        ),
      );
      if (ex.desc) row.append(el("div", { class: "edu-ex-desc" }, ex.desc));
      exWrap.append(row);
    }
    section("ui.edu.example", exWrap);
  }

 // 贴士
  if (Array.isArray(edu.tips) && edu.tips.length) {
    const ul = el("ul", { class: "edu-tips" });
    for (const tip of edu.tips) {
      const li = el("li", { class: "edu-tip" });
      li.append(parseInline(tip));
      ul.append(li);
    }
    section("ui.edu.tips", ul);
  }

  $ws.append(card);
 // 懒加载渲染公式（异步；KaTeX 缺失时降级为原始 TeX，不报错）
  renderMathIn(card);
}

// ---- 密码学密钥+密文一键尝试面板 ----
function renderCryptoTryAll(op) {
  const head = el("div", { class: "op-head" },
    el("div", { class: "op-title" }, msym("vpn_key"), opName(op)),
    opDesc(op) ? el("div", { class: "op-desc" }, opDesc(op)) : null,
  );
  $ws.append(head);

  const cipherInput = ioArea({
    class: "io-area", placeholder: t("ui.crypto.cipherPlaceholder"),
    style: "min-height:100px",
  });
  const keyInput = el("input", {
    type: "text", class: "crypto-input",
    placeholder: t("ui.crypto.keyPlaceholder"), spellcheck: "false",
  });
  const ivInput = el("input", {
    type: "text", class: "crypto-input",
    placeholder: t("ui.crypto.ivPlaceholder"), spellcheck: "false",
  });
  const cribInput = el("input", {
    type: "text", class: "crypto-input",
    placeholder: t("ui.crypto.cribPlaceholder"), spellcheck: "false",
  });

  const form = el("div", { class: "crypto-form" },
    el("div", { class: "crypto-field" }, el("label", {}, t("ui.crypto.cipher")), cipherInput),
    el("div", { class: "crypto-field" }, el("label", {}, t("ui.crypto.key")), keyInput),
    el("div", { class: "crypto-field" }, el("label", {}, t("ui.crypto.iv")), ivInput),
    el("div", { class: "crypto-field" }, el("label", {}, t("ui.crypto.crib")), cribInput),
  );

  const runBtn = el("button", { class: "mid-btn primary crypto-run" }, msym("bolt"), " " + t("ui.crypto.run"));
  const outWrap = el("div", { class: "crypto-out" });

  runBtn.addEventListener("click", async () => {
    outWrap.innerHTML = "";
    const cipherText = cipherInput.value.trim();
    const keyText = keyInput.value.trim();
    const ivText = ivInput.value.trim();
    const crib = cribInput.value.trim();
    if (!cipherText || !keyText) {
      outWrap.append(el("div", { class: "onekey-empty" }, t("ui.crypto.needInput")));
      return;
    }
    outWrap.append(el("div", { class: "crypto-loading" }, t("ui.crypto.loading")));
    try {
      const cands = await cryptoTryAll({ cipherText, keyText, ivText, crib });
      outWrap.innerHTML = "";
      if (!cands.length) {
        outWrap.append(el("div", { class: "onekey-empty" },
          t("ui.crypto.noMatch"),
          el("div", { class: "onekey-hint" }, t("ui.crypto.noMatchHint")),
        ));
        return;
      }
      for (const c of cands) {
        const algoLabel = c.algo + (c.mode ? "-" + c.mode : "") +
          (c.pad === true ? " PKCS7" : (c.pad === false ? " NoPadding" : "")) +
          "  ·  key:" + c.keyEnc + " cipher:" + c.cipherEnc +
          (c.ivEnc ? " iv:" + c.ivEnc : "");
        const cribTag = c.matchesCrib ? " ●" : "";
        const isLong = c.plaintext.length > 500;
        const valEl = el("div", { class: "ok-val" }, isLong ? c.plaintext.slice(0, 500) + " …" : c.plaintext);
        const card = el("div",
          { class: "onekey-card" + (c.matchesCrib ? " crib-hit" : ""),
            title: t("ui.op.copy"),
            onclick: () => { navigator.clipboard?.writeText(c.plaintext); toast(t("ui.toast.copiedResult")); } },
          el("div", { class: "ok-name" }, algoLabel + "　·　" + t("ui.home.confidence") + " " + (c.confidence * 100).toFixed(0) + "%" + cribTag),
          valEl,
        );
        if (isLong) {
          const expandBtn = el("span", { class: "ok-expand" }, t("ui.crypto.expand", c.plaintext.length));
          let expanded = false;
          expandBtn.addEventListener("click", (ev) => {
            ev.stopPropagation();
            expanded = !expanded;
            if (expanded) { valEl.textContent = c.plaintext; expandBtn.textContent = t("ui.crypto.collapse"); }
            else { valEl.textContent = c.plaintext.slice(0, 500) + " …"; expandBtn.textContent = t("ui.crypto.expand", c.plaintext.length); }
          });
          card.append(expandBtn);
        }
        outWrap.append(card);
      }
    } catch (e) {
      outWrap.innerHTML = "";
      outWrap.append(el("div", { class: "file-report-error" }, t("ui.crypto.runFail", (e && e.message ? e.message : String(e)))));
    }
  });

  const toolbar = el("div", { class: "crypto-toolbar" }, runBtn);
  $ws.append(form, toolbar, outWrap);
  renderEduCard(op.id);
  cipherInput.focus();
}

function toolBtn(icon, title, onclick) {
  return el("button", { class: "tool-btn", title, onclick }, msym(icon));
}
function midBtn(icon, title, onclick, primary) {
  return el("button", { class: "mid-btn" + (primary ? " primary" : ""), title, onclick }, msym(icon));
}

function updateDirSeg() {
  const seg = document.getElementById("dirSeg");
  if (!seg) return;
  const [enc, dec] = seg.querySelectorAll("button");
  enc.className = state.dir === "encode" ? "on" : "";
  dec.className = state.dir === "decode" ? "on" : "";
}

function renderParam(op, d) {
  const wrap = el("div", { class: "param" });
  const id = "p_" + d.key;
  if (d.type === "bool") {
    const cb = el("input", { type: "checkbox", id });
    cb.checked = !!state.params[d.key];
    cb.addEventListener("change", () => { state.params[d.key] = cb.checked; convert(); });
    wrap.append(
      el("label", { class: "switch", for: id }, cb, el("span", { class: "track" }), el("span", { class: "knob" })),
      el("label", { for: id }, d.label),
    );
  } else if (d.type === "select") {
    const sel = el("select", { id });
    for (const o of d.options || []) sel.append(el("option", { value: o.value ?? o }, o.label ?? o));
    sel.value = state.params[d.key];
    sel.addEventListener("change", () => { state.params[d.key] = sel.value; convert(); });
    wrap.append(el("label", { for: id }, d.label), sel);
  } else if (d.type === "number") {
 // M3 stepper 自实现，替代浏览器原生 spinner。[−][input][＋] flex 容器。
    const min = d.min ?? null, max = d.max ?? null, step = d.step ?? 1;
    const inp = el("input", { type: "text", inputmode: "numeric", id, class: "stepper-inp", placeholder: d.placeholder || "" });
    inp.value = state.params[d.key] ?? "";
    const clamp = (n) => {
      if (Number.isNaN(n)) return n;
      if (min !== null && n < min) n = min;
      if (max !== null && n > max) n = max;
      return n;
    };
    const commit = (n) => {
      const v = clamp(n);
      state.params[d.key] = v;
      inp.value = Number.isNaN(v) ? "" : String(v);
      convert();
    };
    const bump = (dir) => {
      const cur = Number(inp.value);
      const base = Number.isNaN(cur) ? (min ?? 0) : cur;
      commit(base + dir * step);
    };
    inp.addEventListener("input", () => { state.params[d.key] = Number(inp.value); convert(); });
    inp.addEventListener("blur", () => { if (inp.value !== "") commit(Number(inp.value)); });
    const btn = (iconName, dir, label) => {
      const b = el("button", { type: "button", class: "stepper-btn", "aria-label": label, tabindex: "-1" }, msym(iconName));
      b.addEventListener("click", () => bump(dir));
      return b;
    };
    const box = el("div", { class: "stepper" }, btn("remove", -1, "减"), inp, btn("add", 1, "加"));
    wrap.append(el("label", { for: id }, d.label), box);
  } else if (EXPANDABLE_KEYS.has(d.key)) {
 // 密钥/IV/字典/替换表/crib 等长文本，用可展开输入框（加宽 + 展开 modal）
    const box = expandableInput({
      id, type: "text", value: state.params[d.key] ?? "", placeholder: d.placeholder || "",
      title: t("ui.expand.title"), modalTitle: d.label,
      cancelLabel: t("ui.expand.cancel"), saveLabel: t("ui.expand.save"),
      onInput: (v) => { state.params[d.key] = v; convert(); },
    });
    wrap.append(el("label", { for: id }, d.label), box);
  } else {
    const inp = el("input", { type: d.type === "number" ? "number" : "text", id, placeholder: d.placeholder || "" });
    inp.value = state.params[d.key] ?? "";
    inp.addEventListener("input", () => { state.params[d.key] = d.type === "number" ? Number(inp.value) : inp.value; convert(); });
    wrap.append(el("label", { for: id }, d.label), inp);
  }
  return wrap;
}
// 首页目标特征默认值：常见 CTF flag 格式（正则）。软加权命中置顶高亮，不硬过滤
// 故默认填 flag 也不会误伤纯文本解码（纯文本仍正常出候选，只是不置顶）。
const DEFAULT_CRIB = "flag\\{|ctf\\{|key\\{|flag=|flag:";

// 判定为「密钥类」长文本参数的 key 名（用可展开输入框）
const EXPANDABLE_KEYS = new Set([
  "key", "iv", "dict", "table", "cover", "salt", "crib", "pairs",
  "alphabet", "keyword", "plaintext", "keystream", "password", "map",
]);

// ---- 执行转换 ----
// op 的 encode/decode/run 可返回值或 Promise（WebCrypto 类算法异步）。
// 用 _convSeq 防竞态：慢的异步结果回来时若已不是最新一次调用，丢弃。
let _convSeq = 0;
async function convert() {
  const op = getOp(state.opId);
  if (!op) return;
  const inArea = document.getElementById("ioIn");
  const outArea = document.getElementById("ioOut");
  if (!inArea || !outArea) return;
 // 多字段模式下，从各字段框收集值，按 op.fieldsJoin（默认换行）拼成单一输入串。
  const hasFields = Array.isArray(op.fields) && op.fields.length > 0;
  let text;
  if (hasFields) {
    const vals = op.fields.map((f) => (document.getElementById("fld_" + f.key)?.value ?? ""));
 // 全空则清空输出（等价单框空输入）
    if (vals.every((v) => v === "")) { outArea.value = ""; renderOutMedia(document.getElementById("ioOutMedia"), ""); return; }
    text = vals.join(op.fieldsJoin ?? "\n");
  } else {
    text = inArea.value;
    if (text === "") { outArea.value = ""; renderOutMedia(document.getElementById("ioOutMedia"), ""); return; }
  }
 // MT72：用户勾选了「高级 · 自定义实现」且有代码 → 用用户代码替换本 op 实现。
 // 执行走 Worker 沙箱 + 超时硬杀；结果形态 {ok,out|error} 在此归一为字符串或抛错。
  const ci = getCustomImpl(state.opId);
  const useCi = ci && ci.enabled && ci.code && ci.code.trim();
  const fn = useCi
    ? (text, p) => runCustomWithTimeout({
        code: ci.code, dir: state.dir, input: text, params: p, rawBytes: p.rawBytes || null,
      }).then((r) => {
        if (!r.ok) throw new Error(r.error + (r.line ? `（第 ${r.line} 行）` : ""));
        return r.out;
      })
    : (op.run || (state.dir === "encode" ? op.encode : op.decode));
  const seq = ++_convSeq;
 // 原始字节透传：op 声明 acceptsBytes 且输入框有拖入的真字节时
 // 通过 params.rawBytes 传给执行层（如 PNG 等需要真字节而非 hex 文本的 op）。
 // 未声明的 op 完全不受影响，params 里不注入 rawBytes。
  let callParams = state.params;
  if (op.acceptsBytes && !hasFields && inArea._rawBytes) {
    callParams = { ...state.params, rawBytes: inArea._rawBytes, rawFileName: inArea._rawFileName };
  }
  try {
    // 异步操作前设占位，防用户误判卡死（v0.1.5：压缩/解压可能走 2s 超时 → 纯 JS 兜底）
    outArea.value = t("ui.crypto.loading");
    outArea.style.color = "";
    outArea.classList.remove("error");
    renderOutMedia(document.getElementById("ioOutMedia"), "");
    const out = await fn(text, callParams);
    if (seq !== _convSeq) return; // 有更新的一次转换，丢弃本次
    outArea.value = out;
    outArea.style.color = "";
    outArea.classList.remove("error");
    renderOutMedia(document.getElementById("ioOutMedia"), out);
  } catch (e) {
    if (seq !== _convSeq) return;
    outArea.value = "✗ " + (e.message || t("ui.toast.convertFail"));
    outArea.style.color = "var(--error)";
    outArea.classList.add("error");
    renderOutMedia(document.getElementById("ioOutMedia"), "");
  }
}

// 语言下拉菜单：列全 20 语言（各显自称名），当前语言高亮。选中即 setLocale
// （懒加载语言 await 拉字典 → onLocaleChange 全量重渲染）。点菜单外/再点按钮关闭。
let _langMenu = null;
function closeLangMenu() {
  if (_langMenu) { _langMenu.remove(); _langMenu = null; }
  document.removeEventListener("click", onLangOutside, true);
}
function onLangOutside(e) {
  if (_langMenu && !_langMenu.contains(e.target) && !e.target.closest("#btnLang")) closeLangMenu();
}
function toggleLangMenu(anchor) {
  if (_langMenu) { closeLangMenu(); return; }
  const cur = getLocale();
  const menu = el("div", { class: "lang-menu", role: "menu" });
  for (const code of locales()) {
    const meta = LOCALE_META[code] || { name: code };
    const item = el("div", {
      class: "lang-menu-item" + (code === cur ? " active" : ""),
      role: "menuitem",
      tabindex: "0",
      onclick: () => { closeLangMenu(); setLocale(code); },
      ...keyBtn(() => { closeLangMenu(); setLocale(code); }),
    },
      el("span", { class: "lang-menu-name" }, meta.name),
      meta.dir === "rtl" ? el("span", { class: "lang-menu-tag" }, "RTL") : null,
    );
    menu.appendChild(item);
  }
  const r = anchor.getBoundingClientRect();
  menu.style.position = "fixed";
  menu.style.top = r.bottom + 4 + "px";
  // 纯物理 left 定位 + 溢出保护。不用 insetInlineEnd：菜单 append 到 body，
  // RTL 语言下 body dir=rtl 会把 inline-end 映射成物理 left，值却是「右缘距视口右」
  // 语义 → 菜单飞到对侧 = 偏移 bug。物理坐标不受 dir 影响。
  menu.style.visibility = "hidden";
  document.body.appendChild(menu);
  const mw = menu.offsetWidth;
  // 默认菜单右缘对齐 anchor 右缘（语言按钮在顶栏，右对齐更贴合）
  let left = r.right - mw;
  if (left < 4) left = r.left;                                   // 溢出左边 → 改左缘对齐
  if (left + mw > window.innerWidth - 4) left = window.innerWidth - 4 - mw; // 溢出右边 → 钳制
  menu.style.left = Math.max(4, left) + "px";
  menu.style.visibility = "";
  _langMenu = menu;
  setTimeout(() => document.addEventListener("click", onLangOutside, true), 0);
}

// ============ 昼夜切换（三态：system / light / dark，默认 system 跟随系统）============
// THEME_KEY 持久化用户偏好；无存储时默认 "system"（跟随系统明暗，恒烈需求4）。
const THEME_KEY = "ebctf-theme";
// 系统明暗判定（prefers-color-scheme）。matchMedia 不可用时兜底 dark。
function systemPrefersDark() {
  try { return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches; }
  catch { return true; }
}
// 偏好 → 实际明暗："system" 查系统；否则用偏好本身。
function resolveTheme(pref) {
  if (pref === "light" || pref === "dark") return pref;
  return systemPrefersDark() ? "dark" : "light"; // system
}
// 读当前偏好（system/light/dark），无存储 → "system"。
function themePref() {
  try { const v = localStorage.getItem(THEME_KEY); return (v === "light" || v === "dark" || v === "system") ? v : "system"; }
  catch { return "system"; }
}
// 应用偏好：算实际明暗写 data-theme + 同步图标 + 重算动态取色。persist=true 时持久化偏好。
function applyThemePref(pref, persist, skipAccent) {
  const actual = resolveTheme(pref);
  document.documentElement.setAttribute("data-theme", actual);
  const iconNode = document.querySelector("#btnTheme .msym");
  if (iconNode) iconNode.innerHTML = iconSvg(actual === "dark" ? "dark_mode" : "light_mode");
  if (persist) { try { localStorage.setItem(THEME_KEY, pref); } catch { /* 忽略 */ } }
  // skipAccent：模块顶层启动调用时跳过——此刻 reapplyAccent 依赖的 _systemAccentSeed(const)
  // 尚在 TDZ（暂时性死区），调它会 ReferenceError 中断整个模块。启动的动态取色由后面
  // restoreAccent/enableHctEngine 链负责，无需在此重算。
  if (!skipAccent) reapplyAccent();
  return actual;
}
// setTheme(next?)：next 传 "system"/"light"/"dark" 直接设该偏好；省略=在 light/dark 间切换
// （顶栏按钮点击用，跳过 system——顶栏是快捷明暗切换，环境面板才有跟随系统三选一）。
function setTheme(next) {
  if (next === "system" || next === "light" || next === "dark") return applyThemePref(next, true);
  const curActual = document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
  return applyThemePref(curActual === "dark" ? "light" : "dark", true);
}
// 顶栏按钮循环切换：system → light → dark → system（快捷三态轮转）。
function cycleTheme() {
  const order = ["system", "light", "dark"];
  const cur = themePref();
  const next = order[(order.indexOf(cur) + 1) % 3];
  return applyThemePref(next, true);
}
// 供 envPanel 调用：切换偏好（含 system）+ 读当前偏好（高亮对应按钮）。
// ⚠ 钩子名必须与 envPanel.js 一致：envPanel 用 __ebctfSetThemePref / __ebctfGetThemePref。
window.__ebctfSetThemePref = (pref) => applyThemePref(pref, true);
window.__ebctfGetThemePref = () => themePref();   // 返回偏好（system/light/dark），供 envPanel 高亮
// 旧名保留兼容（顶栏等其它调用方）。
window.__ebctfToggleTheme = (next) => setTheme(next);
window.__ebctfGetTheme = () => themePref();
// 启动时按偏好应用（默认 system 跟随系统）。不持久化（未改变用户选择）。
// skipAccent=true：此刻 _systemAccentSeed(const) 尚在 TDZ，reapplyAccent 会崩，跳过。
applyThemePref(themePref(), false, true);
// system 模式下实时跟随系统明暗变化（用户未显式选 light/dark 时）。
try {
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const onSysChange = () => { if (themePref() === "system") applyThemePref("system", false); };
  if (mq.addEventListener) mq.addEventListener("change", onSysChange);
  else if (mq.addListener) mq.addListener(onSysChange); // 老内核兜底
} catch { /* matchMedia 不可用忽略 */ }

let _pwaRefreshPending = false;

function initPwa() {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!_pwaRefreshPending) return;
    _pwaRefreshPending = false;
    location.reload();
  });
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js", { scope: "./", updateViaCache: "none" }).catch(() => {});
  }, { once: true });
}

function waitForWorkerInstall(worker) {
  if (!worker) return Promise.resolve(null);
  if (worker.state === "installed" || worker.state === "redundant") return Promise.resolve(worker.state);
  return new Promise((resolve) => worker.addEventListener("statechange", () => {
    if (worker.state === "installed" || worker.state === "redundant") resolve(worker.state);
  }));
}

async function checkForUpdate() {
  if (!("serviceWorker" in navigator)) {
    toast(t("ui.topbar.updateUnsupported"));
    return;
  }
  try {
    const registration = await navigator.serviceWorker.getRegistration("./") ||
      await navigator.serviceWorker.register("sw.js", { scope: "./", updateViaCache: "none" });
    await registration.update();
    const installState = await waitForWorkerInstall(registration.installing);
    if (installState === "redundant") throw new Error("Service Worker install failed");
    const waiting = registration.waiting;
    if (waiting && confirm(t("ui.topbar.updateReady"))) {
      _pwaRefreshPending = true;
      waiting.postMessage("SKIP_WAITING");
    } else {
      toast(t("ui.topbar.updateToast"));
    }
  } catch {
    toast(t("ui.topbar.updateFailed"));
  }
}

// ============ 顶栏交互 ============
function initTopbar() {
 // 顶栏版本号由全局 APP_VERSION 注入（index.html 的占位会被覆盖，避免版本号割裂）。
  const appVerEl = document.getElementById("appVer");
  if (appVerEl) appVerEl.textContent = "v" + APP_VERSION;

  document.getElementById("btnTheme").addEventListener("click", () => { cycleTheme(); });
  document.getElementById("btnUpdate").addEventListener("click", checkForUpdate);

 // 语言切换：点开下拉菜单选 20 语言（各显自称名）。选中 setLocale 按需加载 + 全量重渲染。
  const btnLang = document.getElementById("btnLang");
  if (btnLang) {
    btnLang.addEventListener("click", (e) => { e.stopPropagation(); toggleLangMenu(btnLang); });
  }

 // 字库：点开面板，列 4 个 Unicode 平面，可主动预载（要求：全 Unicode 显示 + 标题栏可加载项）。
  const btnFont = document.getElementById("btnFont");
  if (btnFont) {
    btnFont.addEventListener("click", (e) => { e.stopPropagation(); openEnvPanel(btnFont); });
  }

 // 插件：跳独立插件/MCP 页（#/plugins，工作区内渲染，非弹窗）。
  const btnPlugins = document.getElementById("btnPlugins");
  if (btnPlugins) {
    btnPlugins.addEventListener("click", (e) => { e.stopPropagation(); goPlugins(); });
  }

 // 关于：跳独立关于页（#/about，工作区内渲染，非弹窗）。
  const btnAbout = document.getElementById("btnAbout");
  if (btnAbout) {
    btnAbout.addEventListener("click", (e) => { e.stopPropagation(); goAbout(); });
  }

 // 顶栏搜索框：输入实时过滤 op（名称/别名/描述/id），面板列结果，点选跳转。
  initOpSearch();
}

// ---- 字库面板（顶栏「字库」下拉）----
let _fontPanel = null;
function toggleFontPanel(anchor) {
  if (_fontPanel) { _fontPanel.remove(); _fontPanel = null; return; }
  const panel = el("div", { class: "font-panel" });
  const rerender = () => {
    panel.innerHTML = "";
    panel.append(
      el("div", { class: "font-panel-head" }, t("ui.font.title")),
      el("div", { class: "font-panel-note" }, t("ui.font.note")),
    );
    for (const p of FONT_PLANES) {
      const st = fontStatus(p.id);
      const loc = getLocale();
      const btn = el("button",
        { class: "font-load-btn" + (st === "loaded" ? " loaded" : ""),
          disabled: st === "loaded" || st === "loading" },
        st === "loaded" ? t("ui.font.loaded")
          : st === "loading" ? t("ui.font.loading")
          : st === "error" ? t("ui.font.retry")
          : t("ui.font.load"));
      btn.addEventListener("click", () => { loadFontPlane(p.id); });
      panel.append(el("div", { class: "font-plane" },
        el("div", { class: "font-plane-info" },
          el("div", { class: "font-plane-label" }, loc === "en" ? p.labelEn : p.label,
            el("span", { class: "font-plane-size" }, humanSize(p.bytes))),
          el("div", { class: "font-plane-desc" }, loc === "en" ? p.descEn : p.desc),
        ),
        btn,
      ));
    }
  };
  rerender();
  const off = onFontStatusChange(rerender);
  panel._off = off;
  document.body.append(panel);
  _fontPanel = panel;
 // 定位到按钮下方
  const r = anchor.getBoundingClientRect();
  panel.style.top = (r.bottom + 6) + "px";
  panel.style.right = (window.innerWidth - r.right) + "px";
 // 点面板外关闭
  setTimeout(() => {
    const onDoc = (ev) => {
      if (_fontPanel && !_fontPanel.contains(ev.target)) {
        _fontPanel._off && _fontPanel._off();
        _fontPanel.remove(); _fontPanel = null;
        document.removeEventListener("click", onDoc);
      }
    };
    document.addEventListener("click", onDoc);
  }, 0);
}

// ---- 触摸拖拽 → 配方链（HTML5 DnD 在触摸设备不触发，touch 模拟）----
// 长按 320ms 进入拖拽；长按前移动视为正常滚动，避免左侧抽屉无法上下滑。
function attachTouchDragToRecipe(node, getOpId) {
  let timer = null, active = false, tracking = false;
  let sx = 0, sy = 0, ghost = null;

  const chainAt = (x, y) => {
    const chain = document.getElementById("recipeChain");
    if (!chain) return null;
    const r = chain.getBoundingClientRect();
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom ? chain : null;
  };
  const cleanup = () => {
    clearTimeout(timer); timer = null;
    tracking = false; active = false;
    node.classList.remove("touch-dragging");
    document.getElementById("recipeChain")?.classList.remove("recipe-drop-active");
    if (ghost) ghost.remove();
    ghost = null;
  };
  const moveGhost = (t) => {
    if (!ghost) return;
    ghost.style.transform = `translate3d(${t.clientX + 14}px,${t.clientY + 14}px,0)`;
  };

  node.addEventListener("touchstart", (e) => {
    if (e.touches.length !== 1) return;
    const t = e.touches[0];
    sx = t.clientX; sy = t.clientY; tracking = true; active = false;
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (!tracking) return;
      active = true;
      node.classList.add("touch-dragging");
      ghost = document.createElement("div");
      ghost.className = "recipe-touch-ghost";
      ghost.textContent = node.querySelector(".nav-subitem-label, .op-search-item-name")?.textContent || node.textContent.trim();
      document.body.append(ghost);
      moveGhost(t);
    }, 320);
  }, { passive: true });

  node.addEventListener("touchmove", (e) => {
    if (!tracking) return;
    const t = e.touches[0];
    if (!active) {
      if (Math.hypot(t.clientX - sx, t.clientY - sy) > 10) {
        clearTimeout(timer); timer = null; // 普通滑动：不抢滚动
        tracking = false;
      }
      return;
    }
    e.preventDefault();
    moveGhost(t);
    const chain = chainAt(t.clientX, t.clientY);
    document.getElementById("recipeChain")?.classList.toggle("recipe-drop-active", !!chain);
  }, { passive: false });

  node.addEventListener("touchend", (e) => {
    clearTimeout(timer); timer = null;
    if (!tracking || !active) { cleanup(); return; }
    const t = e.changedTouches[0];
    e.preventDefault();
    const opId = getOpId();
    if (opId && chainAt(t.clientX, t.clientY)) addRecipeOpAt(opId, t.clientX, t.clientY);
    cleanup();
  }, { passive: false });
  node.addEventListener("touchcancel", cleanup, { passive: true });
  node.addEventListener("contextmenu", (e) => { if (active) e.preventDefault(); });
}

// ---- 顶栏搜索：名称/别名/描述/id 实时过滤，下拉候选，点选跳转；候选可拖入配方链 ----
// 索引在首次用时构建；语言切换后清空重建（opName/opDesc 随语言变）。
let _searchIndex = null;
function buildSearchIndex() {
  const aliases = eduAliases(); // { opId: [...aka] }
  const idx = [];
  for (const op of OPS) {
    if (op.id === "cryptoTryAll") continue; // 虚拟 op 不进搜索
    const nm = opName(op);
    const ds = opDesc(op);
    const aka = aliases[op.id] || [];
 // 拼一条可小写匹配的检索串：名称 + 别名 + 描述 + id + 分类
    const hay = [nm, ...aka, ds, op.id, op.cat].join("").toLowerCase();
    idx.push({ id: op.id, name: nm, desc: ds, cat: op.cat, aka, hay });
  }
  return idx;
}
function searchOps(q) {
  if (!_searchIndex) _searchIndex = buildSearchIndex();
  const query = q.trim().toLowerCase();
  if (!query) return [];
 // 支持空格分词：全部词都命中才算（AND）
  const terms = query.split(/\s+/).filter(Boolean);
  const scored = [];
  for (const e of _searchIndex) {
    let ok = true;
    let score = 0;
    for (const term of terms) {
      const pos = e.hay.indexOf(term);
      if (pos < 0) { ok = false; break; }
 // 名称开头命中给高分，别名/描述命中给低分
      const nmPos = e.name.toLowerCase().indexOf(term);
      if (nmPos === 0) score += 100;
      else if (nmPos > 0) score += 40;
      else if (e.aka.some((a) => a.toLowerCase().includes(term))) score += 30;
      else score += 10;
    }
    if (ok) scored.push({ e, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 12).map((s) => s.e);
}

let _searchActiveIdx = -1;
function initOpSearch() {
  const input = document.getElementById("opSearchInput");
  const panel = document.getElementById("opSearchPanel");
  if (!input || !panel) return;

  const closePanel = () => {
    panel.classList.remove("open");
    panel.innerHTML = "";
    _searchActiveIdx = -1;
  };

  const pick = (id) => {
    input.value = "";
    closePanel();
    input.blur();
    selectOp(id);
  };

  const renderResults = (results) => {
    panel.innerHTML = "";
    _searchActiveIdx = -1;
    if (!results.length) {
      panel.append(el("div", { class: "op-search-empty" }, t("ui.search.empty")));
      panel.classList.add("open");
      return;
    }
    results.forEach((r, i) => {
      const item = el("div", { class: "op-search-item", "data-idx": String(i), "data-opid": r.id, draggable: "true", title: t("ui.recipe.dragSearchHint") },
        el("div", { class: "op-search-item-main" },
          el("span", { class: "op-search-item-name" }, r.name),
          el("span", { class: "op-search-item-cat" }, catNameById(r.cat)),
        ),
        r.desc ? el("div", { class: "op-search-item-desc" }, r.desc) : null,
      );
      // 桌面：HTML5 DnD → 配方链；mousedown 仍点选跳转。
      item.addEventListener("dragstart", (e) => {
        if (!e.dataTransfer) return;
        e.dataTransfer.effectAllowed = "copy";
        try { e.dataTransfer.setData("application/x-ebctf-op", r.id); } catch { /* ignore */ }
        try { e.dataTransfer.setData("text/plain", r.name); } catch { /* ignore */ }
      });
      item.addEventListener("click", (e) => { e.preventDefault(); pick(r.id); });
      item.addEventListener("mouseenter", () => { setActive(i); });
      // 触摸：长按 320ms 后拖到配方链；轻触仍选中跳转。
      attachTouchDragToRecipe(item, () => r.id);
      panel.append(item);
    });
    panel.classList.add("open");
  };

  const items = () => Array.from(panel.querySelectorAll(".op-search-item"));
  const setActive = (i) => {
    const all = items();
    all.forEach((n) => n.classList.remove("active"));
    _searchActiveIdx = i;
    if (i >= 0 && all[i]) all[i].classList.add("active");
  };

  input.addEventListener("input", () => {
    const results = searchOps(input.value);
    if (!input.value.trim()) { closePanel(); return; }
    renderResults(results);
  });
  input.addEventListener("focus", () => {
    if (input.value.trim()) renderResults(searchOps(input.value));
  });
  input.addEventListener("keydown", (e) => {
    const all = items();
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (all.length) setActive((_searchActiveIdx + 1) % all.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (all.length) setActive((_searchActiveIdx - 1 + all.length) % all.length);
    } else if (e.key === "Enter") {
      const all2 = items();
      if (_searchActiveIdx >= 0 && all2[_searchActiveIdx]) {
        all2[_searchActiveIdx].click();
      } else if (all2.length === 1) {
        all2[0].click();
      }
    } else if (e.key === "Escape") {
      input.value = "";
      closePanel();
      input.blur();
    }
  });
 // 点面板外关闭
  document.addEventListener("click", (ev) => {
    if (!document.getElementById("topbarSearch")?.contains(ev.target)) closePanel();
  });
 // 语言切换后索引失效
  onLocaleChange(() => { _searchIndex = null; });
}
// 按分类 id 取本地化分类名（搜索候选右侧标签用）
function catNameById(catId) {
  const cat = CATEGORIES.find((c) => c.id === catId);
  return cat ? catName(cat) : catId;
}

// ---- 关于页：顶栏「关于」→ 居中 modal ----
// 内容：项目名 / 作者(EternalBlaze) / 版本 / op 统计 / 技术栈 / 零外发声明 /
// GitHub 仓库入口 / 依赖致谢 / 参考项目 / 许可。
const REPO_URL = "https://github.com/Henglie/EBCTFCodeBox";
// 参考项目：写明引用/借鉴内容与地址。
const REFERENCE_PROJECTS = [
  {
    name: "CyberChef（赛博厨师）",
    url: "https://github.com/gchq/CyberChef",
    borrow: "「配方链」线性管道式操作串联的交互范式借鉴自它。",
  },
  {
    name: "ToolsFx（密码学工具箱）",
    url: "https://github.com/Leon406/ToolsFx",
    borrow: "部分古典/现代密码与哈希算法的纯 JS 实现思路参考自其公开实现。",
  },
  {
    name: "flowforge-crypto",
    url: "https://github.com/marlkiller/flowforge-crypto",
    borrow: "早期评估过节点式数据流编排，最终选择更轻的线性配方链，此处记录来源。",
  },
  {
    name: "剪贴板里有什么？ (WhatsInYourClipboard)",
    url: "https://github.com/Henglie/WhatsInYourClipboard",
    borrow: "同作者的前置工程：剪贴板内容智能分类识别（格式嗅探 + 隐写透视）的思路与本工具的「一键解码」相承。",
  },
];
// 关于页：独立路由 #/about，像 op 页一样在工作区渲染（非弹窗）。
// 结构：logo 占位 → 标题 → 简介 → GitHub → 引用项目 → 依赖 → 技术栈 →
//       作者 + 鸣谢 → 注册信息（来源/授权两行）→ 版权（2026–今年，自动取）→ 字库声明。
function renderAbout(host) {
  const page = el("div", { class: "about-page" });

 // ① 顶部 logo（软件图标）
  const logo = el("div", { class: "about-logo", "aria-hidden": "true" },
    el("img", { class: "about-logo-img", src: "public/logo.webp", alt: "", width: "96", height: "96", loading: "lazy" }));

 // ② 标题（去掉 badges，只留名 + 版本号小字）
  const title = el("div", { class: "about-title" }, t("ui.about.appName"));
  const ver = el("div", { class: "about-ver" }, "v" + APP_VERSION);

 // ③ 简介
  const intro = el("p", { class: "about-intro" }, t("ui.about.intro"));

 // ④ GitHub 入口（零外发：仅外跳链接，不嵌徽章图、不拉 star 数）
  const repoBtn = el("a", {
    class: "about-repo-btn", href: REPO_URL, target: "_blank", rel: "noopener noreferrer",
  }, msym("star"), el("span", null, t("ui.about.repoBtn")));

  page.append(el("div", { class: "about-hero" }, logo, title, ver, intro, repoBtn));

 // 通用小节工厂
  const section = (labelKey, ...nodes) => {
    const sec = el("div", { class: "about-section" });
    sec.append(el("div", { class: "about-sec-label" }, t(labelKey)));
    for (const n of nodes) if (n) sec.append(n);
    return sec;
  };

 // op 统计（从 registry 动态取，含 10 大类 + 本地桥细分类）
  const opCount = OPS.length;
  const catCount = CATEGORIES.filter((c) => c.id !== "home").length;

 // ⑤ 技术栈 + 功能规模 + 隐私（键值行）
  const kv = (label, valNode) => el("div", { class: "about-row" },
    el("div", { class: "about-row-label" }, label),
    el("div", { class: "about-row-val" }, valNode),
  );
  page.append(section("ui.about.stack",
    kv(t("ui.about.opCount"), el("span", null, t("ui.about.opCountVal", opCount, catCount))),
    kv(t("ui.about.stack"), el("span", null, t("ui.about.stackVal"))),
    kv(t("ui.about.privacy"), el("span", { class: "about-privacy" }, t("ui.about.privacyVal"))),
  ));

 // ⑥ 参考项目：写明借鉴内容 + 地址
  const refWrap = el("div", { class: "about-refs" });
  for (const r of REFERENCE_PROJECTS) {
    const nameNode = r.url && r.url !== "TODO"
      ? el("a", { class: "about-ref-name", href: r.url, target: "_blank", rel: "noopener noreferrer" }, r.name)
      : el("span", { class: "about-ref-name" }, r.name);
    refWrap.append(el("div", { class: "about-ref" }, nameNode, el("span", { class: "about-ref-note" }, r.borrow)));
  }
  page.append(section("ui.about.refs", refWrap));

 // 依赖与致谢
 // 新增条目的 note 走本地中文兜底（i18n 冻结期不进主表，解冻后回收为正式 key）。
 // ⚠ 许可红线（恒烈）：只列 MIT/BSD/Apache 等宽松许可；GPL/LGPL 等传染性协议不在此列
 //   （如快速换算的 WASM 汇编引擎 Keystone 为 GPL-2.0，按规不展示，许可信息仅存 PROGRESS.md）。
  const _DEP_ZH = {
    "ui.about.depCm": "自定义实现编辑器内核（行号 / 语法高亮 / 查找 / 撤销 / 括号配对），以 MIT 许可内嵌打包，零运行时外发。",
    "ui.about.depCapstone": "机器码反汇编引擎（WASM 编译版），多架构指令级解析，BSD-3-Clause 许可。",
  };
  const depT = (k) => { const v = t(k); return v === k && _DEP_ZH[k] ? _DEP_ZH[k] : v; };
  const deps = [
    { name: "CodeMirror 6", note: depT("ui.about.depCm"), lic: "MIT" },
    { name: "Capstone", note: depT("ui.about.depCapstone"), lic: "BSD-3-Clause" },
    { name: "KaTeX", note: t("ui.about.depKatex"), lic: "MIT" },
    { name: t("ui.about.depTianheng"), note: t("ui.about.depTianhengNote"), lic: t("ui.about.depTianhengLic") },
    { name: "Material Symbols", note: t("ui.about.depMsym"), lic: "Apache-2.0" },
  ];
  const depWrap = el("div", { class: "about-deps" });
  for (const d of deps) {
    depWrap.append(el("div", { class: "about-dep" },
      el("span", { class: "about-dep-name" }, d.name),
      el("span", { class: "about-dep-note" }, d.note),
      el("span", { class: "about-dep-lic" }, d.lic),
    ));
  }
  page.append(section("ui.about.credits", depWrap));

 // ⑦ 作者 + 贡献者（胶囊）+ 鸣谢
 //   创始人：头像 + 加粗名 + 角色徽标；其他开源贡献者：纯胶囊无头像。
  const contribWrap = el("div", { class: "about-contribs" });
  contribWrap.append(
    el("span", { class: "about-capsule about-capsule-founder" },
      el("img", { class: "about-capsule-avatar", src: "public/contributors/fang.jpg", alt: "", loading: "lazy" }),
      el("span", { class: "about-capsule-name" }, "恒烈 · EternalBlaze"),
      el("span", { class: "about-capsule-role" }, t("ui.about.founderBadge")),
    ),
  );
 // 后续贡献者追加到此数组：{ name, tierKey, avatar?, noteKey? }。
 //   tierKey 阶梯：tierAuthor（作者）/ tierDeveloper（开发者）/ tierContributor（贡献者）/ tierFeeder（投喂者）；
 //   founderBadge（创始人·作者）为创始人专属，见上方头像胶囊。
 //   avatar 可选：给了头像即用高亮胶囊（同创始人样式，带圆头像）；noteKey 可选，附贡献说明。
  const OTHER_CONTRIBUTORS = [
    { name: "小布丁", tierKey: "ui.about.tierAuthor", avatar: "public/contributors/xiaobuding.jpg" },
    { name: "yy2m1a0", tierKey: "ui.about.tierContributor", noteKey: "ui.about.contribY2m1a0" },
    { name: "霍雅", tierKey: "ui.about.tierContributor", noteKey: "ui.about.contribHuoya" },
    { name: "0x0off", tierKey: "ui.about.tierContributor", noteKey: "ui.about.contrib0x0off" },
    { name: "懒羊羊大王", tierKey: "ui.about.tierContributor", noteKey: "ui.about.contribLyy" },
    { name: "风之遐想", tierKey: "ui.about.tierContributor", noteKey: "ui.about.contribFzxx" },
    { name: "jluvb", tierKey: "ui.about.tierContributor", noteKey: "ui.about.contribJluvb" },
  ];
  for (const c of OTHER_CONTRIBUTORS) {
    const cap = el("span", { class: c.avatar ? "about-capsule about-capsule-founder" : "about-capsule" });
    if (c.avatar) cap.append(el("img", { class: "about-capsule-avatar", src: c.avatar, alt: "", loading: "lazy" }));
    cap.append(el("span", { class: "about-capsule-name" }, c.name));
    cap.append(el("span", { class: "about-capsule-role" }, t(c.tierKey)));
    if (c.noteKey) cap.append(el("span", { class: "about-capsule-note" }, t(c.noteKey)));
    contribWrap.append(cap);
  }
  page.append(section("ui.about.contributors",
    contribWrap,
    el("p", { class: "about-thanks" }, t("ui.about.thanksVal")),
  ));

 // ⑦.5 授权附加展示项（_license.ext）：全部文本与数据均来自 license.bin，源码不含任何字面量。
 //   无 bin 时 ext 为 null，整体跳过。结构：{ title, img, imgCap, rows:[{icon,label,value,href}] }。
  const ext = _license.ext || null;
  if (ext && typeof ext === "object") {
    const extNodes = [];
    if (ext.img) {
      // 尺寸可选：imgW 数字（px，钳 80~480）→ 覆盖 CSS 默认最大宽；未给则用样式默认值。
      const w = Number(ext.imgW);
      const openImg = () => openImageLightbox(ext.img, ext.imgCap || ext.title || "");
      const imgAttrs = {
        class: "about-ext-media", src: ext.img, alt: ext.imgCap || "", loading: "lazy",
        title: t("ui.ci.zoom"), onclick: openImg, ...keyBtn(openImg),
      };
      // 图 + 图注包进 figure（figure 定宽、图与注都 width:100% 填满）→ 图注收到图片显示宽、居中在图正下方。
      // imgW（bin 可选）覆盖 figure 宽度（非 img max-width）：figure 是定宽基准，图注跟着它收缩。
      const figAttrs = { class: "about-ext-fig" };
      if (Number.isFinite(w) && w > 0) figAttrs.style = `width:${Math.min(Math.max(w, 80), 480)}px`;
      const fig = el("figure", figAttrs, el("img", imgAttrs));
      if (ext.imgCap) fig.append(el("figcaption", { class: "about-ext-cap" }, ext.imgCap));
      extNodes.push(fig);
    }
    if (Array.isArray(ext.rows)) {
      for (const r of ext.rows) {
        if (!r || !r.value) continue;
        const valNode = r.href
          ? el("a", { class: "about-ext-link", href: r.href, target: "_blank", rel: "noopener noreferrer" }, r.value)
          : el("span", { class: "about-ext-val" }, r.value);
        extNodes.push(el("div", { class: "about-ext-row" },
          ...(r.icon ? [msym(r.icon, "about-ext-ico")] : []),
          ...(r.label ? [el("span", { class: "about-ext-label" }, r.label)] : []),
          valNode,
        ));
      }
    }
    if (extNodes.length) {
      const box = el("div", { class: "about-section" });
      if (ext.title) box.append(el("div", { class: "about-sec-label" }, ext.title));
      box.append(...extNodes);
      page.append(box);
    }
  }

 // ⑧ 授权信息（胶囊）：由 license.bin 验签结果驱动。
 //   验签通过 → 绿色「已验证授权」胶囊 + 授权对象 + 签发时间；无 bin / 失败 → 中性「开源自编译」胶囊。
  const licVerified = !!_license.verified;
  // 验签通过 → 三个不同色胶囊各占一行：①授权（绿）②来源（蓝）③签发时间（琥珀）+ 第四行 note 纯文本。
  //   无 bin / 失败 → 单个中性「开源自编译」胶囊。
  const pill = (variant, label, val) =>
    el("div", { class: "about-license-pill about-license-line is-" + variant },
      el("span", { class: "about-license-dot" }),
      el("span", { class: "about-license-status" }, label),
      ...(val ? [
        el("span", { class: "about-license-sep" }, "·"),
        el("span", { class: "about-license-to" }, val),
      ] : []),
    );
  const licNodes = [];
  if (licVerified) {
    licNodes.push(pill("verified", t("ui.about.regVerified"), _license.licensedTo || null));
    if (_license.source) licNodes.push(pill("source", t("ui.about.regFromLabel"), _license.source));
    if (_license.issuedAt) {
      const d = new Date(_license.issuedAt);
      if (!isNaN(d)) licNodes.push(pill("time", t("ui.about.regIssuedAt"), d.toLocaleString()));
    }
    // 第四行：备注（无胶囊，纯文本小字）。
    if (_license.note) licNodes.push(el("div", { class: "about-license-note" }, _license.note));
  } else {
    licNodes.push(pill("oss", t("ui.about.regSourceGithub"), null));
  }
  page.append(section("ui.about.regTitle", ...licNodes));

 // 天珩字库版权与修改声明（作者沈天珩本人要求，法律硬约束）
  page.append(section("ui.about.fontNoticeTitle",
    el("div", { class: "about-font-notice-body" },
      el("p", null, t("ui.about.fontOrigAuthor")),
      el("p", null, t("ui.about.fontModified")),
      el("p", { class: "about-font-warn" }, t("ui.about.fontNonCommercial")),
    ),
  ));

 // ⑨ 版权年份：2026 起，结束年自动取今年（{0} 占位）。
  const thisYear = new Date().getFullYear();
  const yearRange = thisYear > 2026 ? `2026–${thisYear}` : "2026";
  page.append(el("div", { class: "about-copyright" }, t("ui.about.copyright", yearRange)));

  host.append(page);
}

// 应用静态顶栏文案（HTML 里写死的中文 → 按当前语言刷新）。
function applyStaticI18n() {
 // 首屏静态图标：HTML 里写死字面文本（terminal/translate…），启动时注入 SVG，消除闪字。
  const setIcon = (sel, name) => { const n = document.querySelector(sel); if (n) n.innerHTML = iconSvg(name); };
  setIcon("#btnLang .msym", "translate");
  setIcon("#btnFont .msym", "tune");
  setIcon("#btnPlugins .msym", "extension");
  setIcon("#btnAbout .msym", "info");
  setIcon("#topbarSearch .topbar-search-icon", "search");
  setIcon("#btnUpdate .msym", "update");
  setIcon("#btnTheme .msym", document.documentElement.getAttribute("data-theme") === "dark" ? "dark_mode" : "light_mode");

  const set = (sel, txt) => { const n = document.querySelector(sel); if (n) n.textContent = txt; };
  set(".brand-title", t("ui.brand.title"));
  document.title = t("ui.brand.title");
  set("#btnUpdate .icon-btn-label", t("ui.topbar.update"));
  set("#btnLang .icon-btn-label", t("ui.topbar.lang"));
  set("#btnFont .icon-btn-label", t("ui.env.btn"));
  set("#btnPlugins .icon-btn-label", t("ui.plugin.btn"));
  set("#btnAbout .icon-btn-label", t("ui.about.btn"));
  const searchInput = document.getElementById("opSearchInput");
  if (searchInput) searchInput.setAttribute("placeholder", t("ui.search.placeholder"));
  const setAttr = (sel, attr, v) => { const n = document.querySelector(sel); if (n) n.setAttribute(attr, v); };
  setAttr("#btnUpdate", "title", t("ui.topbar.update"));
  setAttr("#btnRepo", "title", t("ui.topbar.repo"));
  setAttr("#btnTheme", "title", t("ui.topbar.theme"));
  setAttr("#btnLang", "title", t("ui.topbar.lang"));
  setAttr("#btnFont", "title", t("ui.env.btn"));
}

// 语言切换 → 全量重渲染（顶栏静态文案 + 导航 + 当前工作区）。
// 切到英文时懒加载英文科普层（首次 import，后续缓存）。
onLocaleChange((loc) => {
  if (loc === "en") {
    import("./core/eduContent.en.js").catch(() => null);
  }
  applyStaticI18n();
  renderNav();
  renderWorkspace();
});

// ============ 注册密钥+密文一键尝试（virtual op，renderOp 特殊渲染）============
register({
  id: "cryptoTryAll",
  cat: "crypto",
  name: "密钥+密文一键尝试",
  desc: "给定密文+密钥(+IV)，自动枚举 AES/DES/3DES/RC4/XOR/Fernet × ECB/CBC/CFB/OFB/CTR × 4 编码组合，用 crib 或可打印率+熵打分",
  params: [],
  run: async () => "",
});

// ---- 侧栏拖拽调宽：拖 .nav-resizer 改 --nav-w（会话态，不持久化）。
// 折叠态不响应拖拽；展开后恢复上次拖出的宽度。范围 180-480px。
function initNavResizer() {
  const rez = document.getElementById("navResizer");
  const nav = $nav;
  if (!rez || !nav) return;
  let dragging = false;
  const onMove = (e) => {
    if (!dragging) return;
    const x = e.touches ? e.touches[0].clientX : e.clientX;
    const w = Math.max(180, Math.min(480, x - nav.getBoundingClientRect().left));
    state.navW = w;
    document.documentElement.style.setProperty("--nav-w", w + "px");
  };
  const stop = () => {
    if (!dragging) return;
    dragging = false;
    document.body.classList.remove("nav-resizing");
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", stop);
  };
  const start = (e) => {
    if (navRail()) return; // 折叠态 / 窄屏 rail 不拖
    dragging = true;
    document.body.classList.add("nav-resizing");
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", stop);
    e.preventDefault();
  };
  rez.addEventListener("mousedown", start);
 // 双击把手 → 复位默认宽度
  rez.addEventListener("dblclick", () => {
    state.navW = 0;
    document.documentElement.style.removeProperty("--nav-w");
  });
}

// ============ 启动 ============
initPwa();
// 加载屏遮白屏。模块顶层 import 已完成才执行到这，故进度从「初始化界面」起步。
setLoadingProgress(60, "ui.loading.ui");
applyStaticI18n();
initTopbar();
initNavResizer();
// 窄屏边界交叉时重渲导航：rail 态随视口宽度切换（navRail()），否则已展开的二级菜单
// 在 resize 后仍残留 260px 宽渲染、rail 60px 里横向溢出（穿模）。
let _lastNavRail = null;
function trackNavRail() {
  const r = navRail();
  if (_lastNavRail !== null && r !== _lastNavRail) renderNav();
  _lastNavRail = r;
}
window.addEventListener("resize", trackNavRail);
trackNavRail();
// 启动时恢复用户上次选的强调色（localStorage），随当前 data-theme 明暗重算 tonal。
applySavedAccent();
// 后台启用 B 路线 HCT 精确引擎（Google material-color-utilities，本地 vendor 懒加载）。
// 加载完用精确 tonal 重算一次（渐进增强：A 路线已先出色，HCT 到位后无缝替换）。失败静默留 A 路线。
enableHctEngine().then((ok) => { if (ok) reapplyAccent(); }).catch(() => { /* 降级留 A 路线 */ });
// 按当前 hash 定位（#/op/xxx 直达该功能，刷新/中键多开保持）；无 hash → 首页
applyRoute();
// 授权：异步读 license.bin 验签，写回 _license；若当前在关于页则重渲染以显示授权信息。
// fire-and-forget，不阻塞启动。未读到 / 验签失败时 _license 保持开源自编译默认。
loadLicense().then((lic) => {
  if (lic) _license = lic;
  if (state.view === "about") renderWorkspace();
}).catch(() => { /* 读取失败静默留开源默认 */ });
setLoadingProgress(100, "ui.loading.ready");
hideLoadingScreen();
// 持久化语言若是懒加载语言（非 zh/en）：首屏先用 zh 回退渲染，字典异步拉到后重渲染。
// fire-and-forget，绝不阻塞启动（顶层 await 会中断后续按钮绑定，故不用）。
initLocale().then((loc) => {
  if (loc && loc !== "zh" && loc !== "en") { applyStaticI18n(); renderNav(); renderWorkspace(); }
}).catch(() => { /* 语言包加载失败静默留 zh 回退 */ });
// 区分本地版 vs 服务器版。判据 = bridge 是否在线（点我启动.py 本地部署会同进程自启桥）。
// 本地版：桥在 → 页面加载完后后台渐进拉全量天珩 4 平面（补冷僻字，不阻塞首屏）。
// 服务器版：桥不在 → 只留首屏子集，全量 31MB 不自动拉（省带宽/加速首屏），留环境面板手动加载。
// ---------- M3 动态取色（种子色 → tonal 语义变量，本地纯计算零外发）----------
// 用户在环境面板选强调色 → 存 localStorage("ebctf.accent") → applyAccent 覆盖 primary 族。
// 默认不设（留空）→ 用 theme.css 出厂砖红，不动。设过才生效。
const ACCENT_KEY = "ebctf.accent";
function currentThemeDark() {
  return document.documentElement.getAttribute("data-theme") !== "light";
}
function applySavedAccent() {
  let seed = null;
  try { seed = localStorage.getItem(ACCENT_KEY); } catch { /* 隐私模式忽略 */ }
 // 无保存色 → 回落默认砖红种子，走动态取色管线生成整套 M3 主题（含淡暖灰中性 surface）
 // 而非停在 theme.css 静态重酒红中性。这样默认整站是 M3 生成的暖主题，换色时无缝切色系。
  if (!seed) seed = DEFAULT_ACCENT.seed;
  try { applyAccent(seed, { dark: currentThemeDark() }); } catch { /* 非法值忽略 */ }
}
// 主题切换后调：设过自定义色才以新明暗重算，否则不动（出厂色随 theme.css 自动切）。
// 无用户保存色但启动已应用系统强调色时，回退用系统色重算（明暗切换跟随系统色）。
function reapplyAccent() {
  let seed = null;
  try { seed = localStorage.getItem(ACCENT_KEY); } catch { /* 忽略 */ }
  if (!seed) seed = _systemAccentSeed;
 // 无用户色/系统色 → 回落默认砖红种子，仍走动态管线（生成 M3 淡暖灰中性，非 theme.css 静态重酒红）
  if (!seed) seed = DEFAULT_ACCENT.seed;
  try { applyAccent(seed, { dark: currentThemeDark() }); } catch { /* 忽略 */ }
}

// ---------- 系统强调色（本地桥读 Windows 注册表 AccentColor，零外发）----------
// 仅 fetch 本机 bridge（127.0.0.1:8181/api/accent）。成功返 {accent:"#RRGGBB",…}；
// 非 Windows / 读失败 → 501；桥不在 → fetch 抛错。任一失败均静默降级 theme.css 砖红。
// 系统色不写 localStorage（属「跟随系统」而非用户显式选色），单记 _systemAccentSeed
// 供主题明暗切换时 reapplyAccent 复算。用户在环境面板手动「同步系统色」才持久化为选择。
let _systemAccentSeed = null;
// 归一化 #RRGGBB（大写转小写 + 合法校验）；非法返 null
function normAccentHex(v) {
  if (!v) return null;
  let h = String(v).trim().toLowerCase().replace(/^#/, "");
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  if (h.length !== 6 || /[^0-9a-f]/.test(h)) return null;
  return "#" + h;
}
// fetch 系统强调色 → 合法 #RRGGBB 或 null（不抛错，供降级）。
async function fetchSystemAccent() {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 1500);
    const r = await fetch("http://127.0.0.1:8181/api/accent", { signal: ctrl.signal, cache: "no-store" });
    clearTimeout(timer);
    if (!r.ok) return null;                 // 501（非 Win/读失败）→ 降级
    const j = await r.json();
    return j && j.accent ? normAccentHex(j.accent) : null;
  } catch {
    return null;                            // 桥不在 / 超时 / 解析失败 → 降级
  }
}
// 启动时（仅本地版）：用户未手动选过色 → 用系统色做默认动态取色。尊重已保存的用户选择。
async function initSystemAccent() {
  let saved = null;
  try { saved = localStorage.getItem(ACCENT_KEY); } catch { /* 忽略 */ }
  if (saved) return;                        // 用户已显式选色，不覆盖
  const hex = await fetchSystemAccent();
  if (!hex) return;                         // 降级：静默留 theme.css 砖红
  _systemAccentSeed = hex;
  try { applyAccent(hex, { dark: currentThemeDark() }); } catch { return; }
  console.info("[accent] 已应用系统强调色 " + hex);   // 降级链上最多一条 info
}
// 供 envPanel「同步系统色」按钮调用：手动读系统色并应用。用户主动点 → 持久化为选择。
// 返回 { ok, accent } 供 UI toast 反馈。
window.__ebctfSyncAccent = async () => {
  const hex = await fetchSystemAccent();
  if (!hex) return { ok: false };
  try { applyAccent(hex, { dark: currentThemeDark() }); } catch { return { ok: false }; }
  try { localStorage.setItem(ACCENT_KEY, hex); } catch { /* 忽略 */ }
  _systemAccentSeed = null;                 // 已持久化为用户选择，清系统色临时态
  return { ok: true, accent: hex };
};
// 供 envPanel 色板 UI 调用：选色即时应用 + 持久化；resetAccent 由 envPanel 直接 import。
window.__ebctfSetAccent = (seed) => {
  try { applyAccent(seed, { dark: currentThemeDark() }); } catch { /* 忽略 */ }
  try { localStorage.setItem(ACCENT_KEY, seed); } catch { /* 忽略 */ }
};
window.__ebctfClearAccent = () => {
  try { localStorage.removeItem(ACCENT_KEY); } catch { /* 忽略 */ }
};

// window.__ebctfRuntime 供 envPanel 等读取当前形态（"local" | "server"，探测前 null）。
window.__ebctfRuntime = null;
async function detectRuntimeAndPreload() {
  let isLocal = false;
  try {
    const h = await bridgeHealth();
    isLocal = !!(h && h.ok);
  } catch { isLocal = false; }
  window.__ebctfRuntime = isLocal ? "local" : "server";
  if (isLocal) {
    preloadAllPlanes();   // 仅本地版后台补全量字库；服务器版留子集 + 手动加载
    initSystemAccent();   // 仅本地版且用户未选色时，用系统强调色做默认动态取色（失败静默降级）
  }
  restorePlugins();       // 后台恢复上次启用的插件（动态 import，不进主 bundle、不拖首屏）
}

// 插件系统：动态 import 宿主，恢复用户上次启用的插件。宿主/插件全按需加载
// 主项目不静态依赖任何插件，失败静默降级不阻塞启动。内置示例插件随主项目分发免 URL。
async function restorePlugins() {
  try {
    const host = await import("./plugin/pluginHost.js");
    const builtins = {};
 // 内置参考插件（默认不启用，用户在插件面板可一键启用；此处只登记免 URL 供恢复）
    builtins["hello-cipher"] = await import("./plugin/examples/hello-cipher/index.js");
    await host.restoreEnabled(builtins);
    host.onPluginsChange(() => { try { renderNav(); } catch { /* 忽略 */ } });
  } catch (e) {
    console.warn("[plugin] 宿主加载失败，已跳过（不影响主功能）：", e && e.message ? e.message : e);
  }
}
if (document.readyState === "complete") detectRuntimeAndPreload();
else window.addEventListener("load", detectRuntimeAndPreload, { once: true });
