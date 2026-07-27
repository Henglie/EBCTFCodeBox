/*
 * core/registerAll.js — 全算法注册入口（副作用 barrel，自动生成，勿手改）
 *
 * 由 工具/_gen_registerall.mjs 从 src/main.js 抽取所有 core 副作用 import 生成。
 * main.js 与 magic/magicWorker.js 共用此入口，确保主线程与 Worker 注册的 op 完全一致
 * （单一事实源，避免两处 import 列表漂移导致 Worker 少注册 op）。
 *
 * 注册顺序 = main.js 中原始顺序（detectExt/detectSupplement 系列在末尾，依赖其他 op 先注册）。
 * 新增算法：在 main.js 加 import "./core/xxx.js" 后重跑 工具/_gen_registerall.mjs 即可。
 */
import "./base.js";
import "./baseExt.js";
import "./text.js";
import "./textExt.js";
import "./fancy.js";
import "./fancy2.js";
import "./fancyExt.js";
import "./txtmoji.js"; // txtmoji.com emoji 加密 txtmoji（fancy, 双向, AES-256-CBC OpenSSL + 65 emoji 表 + 切固定前缀, 需密码, 逆向自 txtmoji.com）
import "./keyboard.js";
import "./classic.js";
import "./classicExt2.js"; // 古典密码补全组2（Trithemius）
import "./radix.js";
import "./radixExt.js";
import "./hash.js";
import "./hashExt.js";
import "./cn.js";
import "./modern.js";
import "./modernExt.js";
import "./modernExt2.js"; // 现代分组密码补全组2（RC5/IDEA/Blowfish/RC6）
import "./analysis.js";
import "./stego.js";
import "./lib/sjcl.js";
import "./stegoImage.js";
import "./stegoImage2.js"; // 图像隐写扩展（PNG全块/JPEG APPn/GIF注释/GIF多帧/ICC剥离）
import "./imagefix.js"; // 图像尺寸修复（pngSizeRecover/jpegSizeRead/gifSizeRead，替代 pngFix，更全）
import "./trailerCarve.js"; // 文件附加数据剥离 + binwalk 式全文魔数扫描（替代 carve）
import "./stegoText.js"; // 隐写文本检测组（零宽/同形字/规范化/空格/Bidi/字符透视，检测类 run 单向）
import "./invisibles.js"; // 不可见字符可视化（零宽/控制符/BOM/空白 → 可见占位符 + scan/visualize/strip）
import "./workerPool.js";
import "./detectExt.js"; // detect 补全扩展层
import "./detectExt2.js"; // detect 大表补强（82 op 补 detect，提升一把梭命中率）
import "./exclusiveCodec.js"; // 冷门/独有算法复刻
import "./token.js"; // JWT/令牌解析组
import "./netcodec.js"; // 网络/协议编码组
import "./timecodec.js"; // 时间戳/日期编码组
import "./checkdigit.js"; // 条码/校验位组
import "./morseExt.js"; // 摩斯/声光编码扩展组
import "./fancy3.js"; // 花式趣味编码补全组（Whitespace/Pigpen/键盘漂移/Malbolge 识别）
import "./compress.js"; // 压缩/归档识别组（gzip/zlib/deflate 解压 + zip/tar 结构 + magic 识别）
import "./hashCrack.js"; // 哈希爆破/彩虹表组（哈希类型识别 + 字典爆破 + 彩虹表 + HMAC 爆破）
import "./cryptanalysis.js"; // 密码分析工具组（频率分析/IC/Kasiski/卡方/单表替换求解/凯撒求位移）
import "./cryptanalysis2.js"; // 密码分析扩展（维吉尼亚全自动/Hill已知明文/Playfair爬山）
import "./cryptoTryAll.js"; // 密钥+密文一键尝试（枚举 AES/DES/3DES/RC4/XOR/Fernet × 模式 × 编码试解）
import "./qrcode.js"; // 二维码/条码组（QR 生成/结构解析 + Aztec/DataMatrix 识别 + 条码判定）
import "./qrdecode.js"; // QR 真解码组（矩阵→原文：finder/格式信息/之字形取数/掩码还原/RS 纠错/模式解码）
import "./keyboardExt.js"; // 键盘/布局编码补全组（QWERTY↔Dvorak↔Colemak + T9 + 多击 + 行列坐标 + Steno + 方向键）
import "./rsatool.js"; // 数论/RSA 攻击工具组（参数计算/小e/共模/Wiener/费马/Pollard/模逆/egcd/CRT/快速幂）
import "./rsatoolExt.js"; // RSA 攻击扩展（dp/dq泄露/LSB Oracle/Bleichenbacher/Coppersmith/Boneh-Durfee）
import "./eccdetect.js"; // 椭圆曲线/现代密码识别组（PEM/DER 结构解析 + ASN.1 TLV + EC 曲线识别 + SSH 公钥 + BTC/ETH 地址）
import "./charset.js"; // charset/encoding group (GBK/Big5/SJIS/EUC-KR/Latin/EBCDIC/UTF-16/QuWei/mojibake)
import "./signal.js"; // 数字信号编码组（曼彻斯特/差分曼彻斯特/NRZI/密勒码/4B5B/PWM-PPM 比特流互转）
import "./geo.js"; // GPS/地理编码组（DMS/geohash/Plus Code(OLC)/Maidenhead/UTM 双向互转）
import "./color.js"; // 颜色编码组（RGB↔HSL↔HSV↔CMYK↔Hex↔Int↔CSS 命名色）
import "./music.js"; // 音乐/乐谱编码组（音名/MIDI/简谱/唱名 四向互转 + 频率）
import "./confusables.js"; // Unicode 同形字 confusables（skeleton 骨架归一化 + 混用告警）
import "./checksumExt.js"; // 校验和扩展组（通用 CRC + CRC-16 预设 + Fletcher16/32 + BSD/SysV sum）
import "./bitops.js";
import "./netcodecExt.js"; // 网络编码扩展组（URL query/Cookie/Basic 认证/data URI/magnet 解析）
import "./serial.js"; // 序列化格式识别组（protobuf/MessagePack/CBOR/BSON/PHP serialize/Java 序列化识别）
import "./timecodecExt.js"; // 时间戳扩展组（儒略日/Excel序列日期/Chrome时间/Twitter雪花ID）
import "./hexview.js"; // hexview (hexdump/range/stats)
import "./audiostego.js"; // 音频隐写识别组（WAV头解析/音频LSB提取/DTMF Goertzel/SSTV识别，run 单向分析类）
import "./esolang2.js"; // esolang 扩展组
import "./difftool.js"; // diff 对比工具（两文本/两 hex 逐字节 diff，run 单向分析类）
import "./classicExt3.js"; // 古典补全组3（otp/multiplicative/keywordcipher/simplesub/runningkey）
import "./fracmorse.js"; // 分数摩斯 Fractionated Morse
import "./hamming.js"; // 海明码纠错编解码
import "./snow.js"; // Snow 行尾空白隐写（Space/Tab 编码比特）
import "./bazeries.js"; // Bazeries 密码（5×5 方阵+数字key分组反转）
import "./fenham.js"; // Fenham 密码（ASCII 二进制逐位 XOR）
import "./pizzini.js"; // Pizzini 密码（A-Z→4-29 数字替换）
import "./kamasutra.js"; // Kamasutra 爱经密码（配对表替换，自反）
import "./suiYanSuiYu.js"; // 随言随语（ord转4进制+字典映射）
import "./fuyouyue.js"; // 佛又曰+天书（AES-256-CBC+心经/道经映射）
import "./xiongyue.js"; // 熊曰（zlib压缩+base91+熊语字典）
import "./huoxingwen.js"; // 火星文+简繁转换（三向字库转换）
import "./qqxiuzi_hex.js"; // QQ秀 hex 族（arrow/flower/ipa/letter）
import "./qqxiuzi_misc.js"; // QQ秀异构族（braille/chinese/music）
import "./lolcode.js"; // LOLCODE 语言映射
import "./enigma.js"; // Enigma 恩尼格玛机
import "./m209.js"; // M-209 转轮密码机
import "./bwt.js"; // BWT 块排序变换
import "./clockcipher.js"; // 表盘码 / 时钟码
import "./bech32.js"; // Bech32 编码
import "./byteTools.js"; // UUID解析/VarInt/字节序交换
import "./lzcodec.js"; // LZString 压缩
import "./streamcipher.js"; // Rabbit 流密码
import "./flashswirl.js"; // FlashSwirl 闪旋 ARX 流密码（风之暇想）
import "./sevenzip.js"; // 7z 归档解析/解压（run 型，wasm 缺失降级纯头解析）
import "./exebridge.js"; // pyc/exe 反编译（本地桥，run 型 op）
import "./crc32collision.js"; // CRC32 碰撞爆破（analysis, run 型）
import "./rotspecial.js"; // Rot 任意位移 + ROT8000（classic/fancy）
import "./pickle.js"; // Pickle 反汇编（analysis, run 型, 危险 opcode 告警）
import "./jjencode.js"; // JJEncode（JS 符号混淆编码, fancy）
import "./sm.js"; // 国密 ZUC/SM2/SM9（modern，ZUC 完整流密码，SM2/SM9 结构识别）
import "./archiveUnified.js"; // 压缩/归档归一（analysis, run 型, 复用 compress+sevenzip 纯函数）
import "./spoon.js"; // Spoon 语言（BF 前缀码变体, fancy）
import "./ssti.js"; // SSTI 关键字识别（analysis, run 型, 只识别不执行）
import "./pinyin.js"; // 数字转拼音 + 汉字转拼音（cn）
import "./goldbug.js"; // Goldbug 金甲虫密码（classic, 有 detect, 须在 detectSupplement 前）
import "./usbHid.js"; // USB HID 流量解析（键盘/鼠标 leftover capture data, run 型 analysis）
import "./exeTools.js"; // 外部 exe 工具接入(bftools/npiet/stegdetect)+GUI直启(watermarkH/JPHS/NTFS流/OpenPuff/OurSecret)，带 requiresBridge 徽章
import "./textStego.js"; // 文本隐写入口（acrostic/everyN/caseBitStego/nthChar/wordSpacingBits，明文藏明文，区别于零宽）
import "./imageStructUnified.js"; // 图像结构归一（PNG/JPG/GIF/BMP 按 magic 分派 sections，有 detect）
import "./cryptoAddrUnified.js"; // 加密货币地址解析（BTC/ETH/LTC/DOGE/TRON，有 detect）
import "./fullwidth.js"; // 全角密码（有 detect）
import "./routecipher.js"; // 曲路密码 routeCipher（classic）
import "./md2.js"; // MD2 哈希
import "./otp.js"; // HOTP/TOTP
import "./kdf.js"; // PBKDF2/HKDF
import "./pietExec.js"; // Piet 执行（fancy，有 detect）
import "./carbonaro.js"; // Carbonaro 密码（classic）
import "./albam.js"; // Al Bhed / Albam 替换（classic）
import "./bfDialects.js"; // BF 方言 Blub/COW（fancy，有 detect）
import "./zipCrack.js"; // ZIP 弱口令爆破（analysis, run 型, 单向）
import "./chaocipher.js"; // 混沌密码 chaocipher（classic, 双向）
import "./john_zip.js"; // ZIP哈希提取 zip2john（analysis, run）
import "./rsaBatchGcd.js"; // RSA批量GCD rsaBatchGcd（analysis, run, 复用 rsatool）
import "./rsaHastad.js"; // RSA Håstad广播攻击 rsaHastad（analysis, run, 复用 rsatool）
import "./rsaPollardPm1.js"; // RSA Pollard p-1 rsaPollardPm1（analysis, run, 复用 rsatool）
import "./straddleCheckerboard.js"; // 跨界棋盘密码 straddleCheckerboard（classic, 双向）
import "./xorCribDrag.js"; // XOR拖曳已知明文 xorCribDrag（analysis, run）
import "./zipCrc32Brute.js"; // ZIP CRC32内容爆破 zipCrc32Brute（analysis, run）
import "./nihilist.js"; // 虚无党密码 nihilistCipher（classic, 双向, 原 id nihilist 已改避让 classic.js）
import "./solitaire.js"; // Solitaire/Pontifex 扑克流密码（classic, 双向, Schneier 官方向量验证）
import "./alberti.js"; // Alberti 圆盘密码（classic, 双向, 转盘 periodicShift）
import "./wabun.js"; // Wabun 和文摩尔斯（fancy, 双向, 假名↔摩尔斯）
import "./gematria.js"; // Gematria 数值密码（classic, 希伯来/英文/希腊 isopsephy 多计算法）
import "./squareCiphers.js"; // 四方 foursquarekw + 双方 twosquare（classic, 双向, 无 detect）
import "./john_7z.js"; // sevenZip2john 哈希提取（analysis, run, 无 detect）
import "./john_office.js"; // office2john 哈希提取（analysis, run, 无 detect）
import "./john_pdf.js"; // pdf2john 哈希提取（analysis, run, 无 detect）
import "./john_rar.js"; // rar2john 哈希提取（analysis, run, 无 detect）
import "./john_ssh.js"; // sshkey2john 哈希提取（analysis, run, 无 detect）
import "./pcapParse.js"; // pcapParse 流量解析（analysis, run, 无 detect）
import "./cryptoGap.js"; // 密码学缺口 rc2/lmHash/evpBytesToKey（modern+hash, 无 detect）
import "./blindWatermark.js"; // 盲水印 dctWatermarkEmbed/Extract（stego, 无 detect）
import "./bkcrack.js"; // ZipCrypto已知明文攻击 bkcrackAttack（analysis, run, wasm懒加载降级, 无 detect）
import "./pcapDeep.js"; // 流量深度分析 pcapTcpReassemble/pcapHttpExtract/pcapDnsTunnel/pcapIcmpPayload（analysis, run, 无 detect）
import "./dlp.js"; // 离散对数求解 dlp（modern, run, BSGS+Pollard rho, 无 detect）
import "./primeGen.js"; // 大素数生成 primeGen（radix, run, Miller-Rabin, 无 detect）
import "./randomSeed.js"; // 随机种子生成 randomSeed（radix, run, crypto CSPRNG, 无 detect）
import "./dictGen.js"; // 字典生成 dictGen（analysis, run, 笛卡尔积/掩码, 无 detect）
import "./elgamal.js"; // ElGamal 公钥加密 elgamal（modern, 双向, HAC §8.4, 无 detect）
import "./emojiAes.js"; // emoji-aes 完整版 emojiAes（fancy, 双向, 复用 aesEncrypt+md5+EMOJI_INIT）
import "./moyue.js"; // 魔曰 moyue（cn, 双向, vendored abracadabra-cn v3.7.7, 内部 import lib）
import "./mcSave.js"; // Minecraft 存档分析地基 mcLevelDat（analysis, run, 自写大端序 NBT 解析器 + level.dat 摘要, 无 detect）
import "./mcText.js"; // Minecraft 文本情报提取 mcTextExtract（analysis, run, Anvil MCA + 复用 mcSave NBT 解析器, 抽告示牌/书/命令/CustomName/物品名, flag 高亮, 无 detect）
import "./mcMap.js"; // Minecraft 地图物品渲染 mcMapRender（analysis, run, map_#.dat gzip NBT → data.colors 128×128 → MC 调色板 → 手写 PNG dataURL, 无 detect）
import "./webshell.js"; // webshell 流量解密预设（哥斯拉 PHP_XOR_BASE64 / 冰蝎 AES-ECB，固定 key 封装，无 detect）
import "./bin2img.js"; // 二进制转图片 bin2img（stego, run, 0/1 位流 → 黑白点阵 PNG dataURL, 复用 mcMap encodePNG, 无 detect）
import "./imgFft.js"; // 图像 2D FFT 幅度谱 imgFft（stego, run, acceptsBytes, PNG/BMP 灰度重采样 2 幂 + 行列 FFT + fftshift + log 幅度谱 → PNG dataURL, 复用 lsbExtract/mcMap, 无 detect）
import "./mcNbt.js"; // Minecraft 通用 NBT 树查看器 mcNbtView（analysis, run, 复用 mcSave 解析器 + pcapParse inputToBytes, 折叠树/路径过滤/BigInt 不丢精度, 无 detect）
import "./formatSniff.js"; // 格式嗅探 formatSniff（analysis, run, 剪贴板内容识别：JWT/URL/PEM/hash/base系/Python/时间戳/坐标/助记词/ETH/BTC 特征识别, 无 detect）
import "./bcrypt.js"; // Bcrypt 口令哈希/校验 bcrypt（hash, run, 自带 π 常量 EksBlowfish + Radix-64, 不碰 modernExt2）
import "./prngAttack.js"; // PRNG 破解 prngAttack（crypto, run, LCG 参数恢复 + MT19937 untemper, 无 detect）
import "./hashLengthExtension.js"; // 哈希长度扩展攻击 hashLengthExtension（crypto, run, MD5 纯 JS 压缩函数续压, 无 detect）
import "./flagExtract.js"; // flag 自动提取器 flagExtract（analysis, run, 递归多编码 + flag{} 正则闭环, 无 detect）
import "./xorAnalyze.js"; // xortool 一体化 xorAnalyze（analysis, run, 汉明距离猜 keylen + 卡方打分, 无 detect）
import "./ttlStego.js"; // TTL 隐写 ttlStego（analysis, 双向, IP 包 TTL 序列↔比特, 4 锚点归一, 无 detect）
import "./spiralMatrix.js"; // 螺旋矩阵读取 spiralMatrix（analysis, 双向, LeetCode 54/59 螺旋序, 无 detect）
import "./nonogram.js"; // 数织 Nonogram nonogram（analysis, run, 线求解器迭代收敛, 无 detect）
import "./simonSpeck.js"; // NSA Simon/Speck 轻量分组密码 simonSpeck（modern, 双向, BigInt, NSA 官方向量验证, 无 detect）
import "./knapsack.js"; // 背包加密 Merkle-Hellman knapsack（modern, 双向, BigInt 超递增背包, 无 detect）
import "./dsa.js"; // DSA 签名/验签/重用k攻击 dsa（crypto, run, FIPS 186 + 内置纯 JS SHA-1, 无 detect）
import "./bmpPalette.js"; // BMP 调色板隐写分析 bmpPalette（stego, run, 1/4/8-bit 索引 BMP 调色板 LSB/索引序/未用索引, 无 detect）
import "./stegosaurus.js"; // Stegosaurus pyc 隐写检测 stegosaurus（forensic, run, marshal code object 静态解析 + lnotab LSB, 无 detect）
import "./pcapRepair.js"; // pcap 文件修复 pcapRepair（analysis, run, magic/字节序/全局头/incl_len 诊断修复, 无 detect）
import "./spectrogram.js"; // 音频频谱图 spectrogram（stego, run, STFT + radix-2 FFT + Hann 窗 + magma 色阶 → PNG dataURL, 复用 audiostego/mcMap, 无 detect）
import "./lfsrRecover.js"; // LFSR 序列恢复 lfsrRecover（analysis, run, Berlekamp-Massey 求最短 LFSR + 反馈多项式 + 外推预测, 无 detect）
import "./rc4Visualize.js"; // RC4 KSA/PRGA 可视化 rc4Visualize（analysis, run, 逐步展示 KSA 打乱 + PRGA 密钥流, 无 detect）
import "./f5stego.js"; // F5 JPEG 隐写提取 f5stego（stego, run, acceptsBytes, 熵解码+密钥置换+(1,2^k-1,k)矩阵编码, 仅提取, 无 detect）
import "./lllAttack.js"; // 格基归约 LLL + 背包低密度攻击 CJLOSS（crypto, run, BigInt 精确有理 GSO, 无 detect）
import "./xiangyue.js"; // 想曰 XiangYue 完整版解密 xiangyue（cn, run async, 中/日/韩/Emoji/零宽/象形映射 → Argon2id/PBKDF2 + ChaCha20-Poly1305 + AES-CTR + zlib, 纯JS原语自验, 无 detect）
import "./lightweightStream.js"; // eSTREAM/NIST 轻量级流密码 trivium/grainV1/grain128aead（modern, 双向, 官方向量验证）
import "./fengCodec.js"; // 风之暇想 uid=243467 编码 dxBase64（base, 双向, deflate+salt XOR+CRC16）/ yueChang 曰唱（cn, 双向, PBKDF2+AES-GCM+拟声字映射, 源码逐行核验）
import "./detectExt3.js"; // EASY 30 op detect 补齐（须在所有 op 注册后）
import "./detectSupplement.js"; // 编码类 detect 覆盖补齐（须在所有 op 注册后）
