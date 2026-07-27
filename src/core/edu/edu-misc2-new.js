// 科普卡数据分片：misc2-new。cn 5 + stego 4 + hash 3 + base 1 + classic 6 + radix 5 = 24 op。
// 纯数据，无 import 无副作用。内容按各 op 源码实事求是编写，作者/前缀/口令均与源码一致。
export default {
 // ============ cn / 中文本土编码 ============
  yueChang: {
    what: "曰唱：风之暇想（fzxx）的作品，把一段文字压缩加密后，映射成一串中文拟声字（啊嘶呼呀嗞…），前缀「唱：」。",
    principle:
      "本质是「压缩 + 加密 + 换皮」三步。\n\n" +
      "编码：原文先 deflate 压缩 → 用口令经 $PBKDF2\\text{-}SHA256$（10 万次迭代）派生出 AES-GCM-256 密钥 → 加密（随机 8 字节 salt + 12 字节 iv）→ 帧 `salt||iv||密文` 转标准 Base64 → 再把 Base64 的 65 个字符（A-Z a-z 0-9 + / =）逐个映射成一个中文拟声字 → 加前缀「唱：」（唱 + 全角冒号）。\n\n" +
      "口令默认 `YueChang`（留空即用默认）。因含随机 salt/iv，同一明文每次密文都不同，靠 AES-GCM 认证标签保证完整性。",
    usage: "编码：输入文本，可选填口令（留空用默认 YueChang），输出「唱：…」拟声字串。解码：粘拟声字串，口令须与加密时一致。",
    examples: [
      { in: "hello", param: "口令留空", out: "唱：啊嘶呼呀…（每次不同）", desc: "含随机 iv，密文非固定" },
    ],
    tips: ["看到「唱：」开头 + 一串「啊嘶呼呀嗞哦啪啦」这类拟声字，就是曰唱。", "口令错了 GCM 认证会失败，直接报解密错误——不是密文坏了就是口令不对。"],
    aka: ["曰唱", "yuechang", "YueChang", "风之暇想", "fzxx", "唱语", "拟声字加密", "唱前缀编码",
      "中文拟声加密", "aes拟声编码", "曰唱编码", "yue chang", "与佛论禅加密版"],
  },

  moyue: {
    what: "魔曰：SheepChef 的 Abracadabra 中文版移植，把文字加密后伪装成一段仿文言文（或纯字符替换串），要密钥才能解。",
    principle:
      "上游是完整加密管线：$UNISHOX2/GZIP$ 压缩 → $AES\\text{-}256\\text{-}CTR$ → 梅森旋转（MersenneTwister）随机 → 旋转字表大字典替换 → Luhn 校验位。\n\n" +
      "两种模式：文言仿真（classical，默认，输出像文言文，可带标点/骈文/逻辑风格选项）和传统（traditional，纯字符替换串，无文风）。两模式密文互不兼容，交叉解码会报错，解码失败会自动回退另一模式再试。\n\n" +
      "默认密钥 `ABRACADABRA`。encode 含随机数（以 Date.now() 播种），同一明文每次密文不同，但 decode 恒定可还原；密钥错抛「解码失败」。",
    usage: "选模式（文言仿真/传统）、填密钥（默认 ABRACADABRA）。文言仿真下还可调随机程度(0-100)、是否加标点、骈文、逻辑优先。解码密钥须一致。",
    examples: [
      { in: "flag", param: "模式=文言仿真 密钥默认", out: "一段仿文言文（每次不同）", desc: "含随机播种，密文非固定" },
    ],
    tips: ["密文里夹着 JP 标志字（桜込凪雫実沢）和 CN 标志字（玚俟玊欤瞐珏）且以 CJK 为主，多半是魔曰。", "两模式互不兼容，解不出先换个模式试试。"],
    aka: ["魔曰", "moyue", "abracadabra", "Abracadabra", "SheepChef", "文言仿真加密", "mo yue",
      "魔曰编码", "中文abracadabra", "仿文言文加密", "魔曰密码", "咒语加密", "AES中文伪装"],
  },

  suiYanSuiYu: {
    what: "随言随语（署名伽马）：把每个字符转成 4 进制，再用「随波逐流」四个字当数字符号，拼成一段以「随波逐流语录：」开头的文字。",
    principle:
      "字典 `随波逐流` 四个字代表 4 进制数字 0/1/2/3；长度表 `江河洪浪湖泊海` 七个字代表 4 进制位数 1-7。\n\n" +
      "编码：每个字符取码点 → 转 4 进制字符串 → 每一位查字典映射成对应汉字 → 前面加一个长度前缀字（表示这段有几位）。整体前缀是随机 1-4 个字符 + 「随波逐流语录：」。\n\n" +
      "随机前缀让输出不固定，但 decode 能还原任意合法编码。因长度表只 7 位（$4^7=16384$），码点超过 16383 的字符不支持。",
    usage: "编码：输入文本，输出「随波逐流语录：…」串。解码：粘该串还原原文。",
    examples: [
      { in: "Hi", out: "随波逐流语录：…（随机前缀 + 编码段）", desc: "每次随机前缀不同" },
    ],
    tips: ["看到「随波逐流语录：」开头，或整段只由「随波逐流江河洪浪湖泊海」这 11 个字组成，就是它。", "生僻字/emoji 码点超 16383 无法编码，原算法会报越界。"],
    aka: ["随言随语", "随波逐流语录", "suiyansuiyu", "随波逐流编码", "伽马编码", "sui yan sui yu",
      "四进制汉字编码", "随言随语编码", "随波逐流工具编码", "SBZL", "随语编码", "语录编码"],
  },

  xiangyue: {
    what: "想曰 XiangYue（仅解密方向）：把中文/Emoji/零宽/日文/韩文/象形字密文解回原文，是重加密体系。",
    principle:
      "密文先按字符类型自动识别是哪套映射（中文/Emoji/零宽字符/日文/韩文/象形），反查回 Base64，再自动侦测两种密文格式：\n\n" +
      "format1：seed(16) + ChaCha20-Poly1305 密文，主密钥用 $Argon2id$（t=2, m=64MiB, p=1）派生，再 HKDF-SHA512 派生各子密钥 → ChaCha20-Poly1305 → AES-CTR → zlib 解压。\n\n" +
      "format2：salt(16)+nonce(12)+密文，$PBKDF2\\text{-}SHA256$（50 万次）派生，HKDF-SHA256 → ChaCha20-Poly1305 → AES-CTR → zlib。\n\n" +
      "内置默认口令 `a184f7b849ffed24d266a30298c72ef2f5ad040db73bf37151fac767630728`。反编译源只有解密函数，故本 op 单向解密（format1 的 Argon2id 派生较慢，约数秒）。",
    usage: "粘想曰密文（各种映射自动识别），口令默认内置。可勾「附带识别信息」看识别到的映射类型和格式。仅解密。",
    examples: [
      { in: "（一串想曰中文/Emoji 密文）", param: "口令默认", out: "还原的原文", desc: "自动识别映射与格式" },
    ],
    tips: ["想曰密文形态多变（可能是汉字、Emoji、看不见的零宽字符、日韩文），靠内置 650 条映射表识别。", "format1 用 Argon2id 内存 64MiB，解密会卡一下几秒是正常的。"],
    aka: ["想曰", "xiangyue", "XiangYue", "想曰解密", "zbXiangYue", "xiang yue", "想曰编码",
      "argon2想曰", "chacha想曰", "重加密中文", "想曰密文", "多映射解密", "想曰XiangYue"],
  },

  xiongyue: {
    what: "熊曰：把文字压缩后用 91 个「熊语」汉字（食性很雜既溫和…）编码，前缀「熊曰：呋」。",
    principle:
      "链路：原文 UTF-8 → raw deflate 压缩 → base91 数值编码（13/14 位自适应）→ 每个值（0-90）映射成 91 字熊语字典里的一个汉字 → 整体反转 → 加前缀「熊曰：呋」。\n\n" +
      "base91 把字节流按 13 或 14 位一组打包成 0-90 的数值，比 base64 更紧凑。解码时去前缀、反转、反查字典回数值、base91 还原字节、再 raw inflate 解压。\n\n" +
      "浏览器 deflate 无法指定压缩级别，与 Python 原版字节不完全相同，但解压互通。",
    usage: "编码：输入文本，输出「熊曰：呋…」熊语串。解码：粘该串还原。",
    examples: [
      { in: "hi", out: "熊曰：呋…（熊语汉字）", desc: "前缀固定，正文压缩+base91" },
    ],
    tips: ["看到「熊曰：呋」开头 + 一串「食性很雜哞嗄哈」这类字，就是熊曰。", "「呋」是标头必须在前缀后第一个字，缺了会报「缺失标头」。"],
    aka: ["熊曰", "xiongyue", "熊曰编码", "熊语", "随波逐流熊曰", "zbXiongYue", "xiong yue",
      "熊语编码", "base91熊曰", "熊曰密码", "呋编码", "熊曰：呋", "熊话编码"],
  },

 // ============ stego / 隐写 ============
  dctWatermark: {
    what: "DCT 盲水印：把文本嵌进图片的 DCT 频域，肉眼几乎看不出来，提取时不需要原图（真盲），是 CTF 盲水印常见题型。",
    principle:
      "对图像做 8×8 分块的二维 $DCT\\text{-}II$（离散余弦变换），把每块转到频域。\n\n" +
      "用 QIM（量化索引调制）嵌 bit：把中频系数量化到奇/偶 bin —— $q=\\text{round}(F/Q)$，调 q 的奇偶匹配要嵌的 bit，$F'=q\\cdot Q$；提取时 $b=\\text{round}(F'/Q) \\bmod 2$。默认在 4 个 $u+v=5$ 的中频系数上冗余嵌同一 bit，提取时多数投票，抗 IDCT 取整噪声。\n\n" +
      "payload = 32 位长度头 + UTF-8 字节。中频系数避开 DC（显痕）和高频（脆弱）。提取必须用和嵌入相同的强度 Q 和通道。",
    usage: "嵌入方向：给图 + 文本，输出带水印 PNG。提取方向：只给图，输出文本。参数：强度 Q（16-40，越大越鲁棒越显痕）、嵌入通道（默认 B）。提取须与嵌入的 Q/通道一致。",
    examples: [
      { in: "一张 PNG + 文本 flag{...}", param: "Q=24 通道=B", out: "带水印 PNG", desc: "嵌入方向" },
    ],
    tips: ["提取水印时强度 Q 和通道必须和嵌入时完全一致，否则读出乱码。", "本工具嵌的图本工具能提，但和 Python blind_watermark 库的 DWT-DCT-SVD 版不互通。"],
    aka: ["dct盲水印", "盲水印", "blind watermark", "dct watermark", "频域水印", "qim水印",
      "数字水印", "图片盲水印", "dct隐写", "量化水印", "watermark", "离散余弦水印"],
  },

  bmpPalette: {
    what: "BMP 调色板隐写分析：专查藏在 BMP「调色板」而非像素里的信息，是图像取证高频题。只分析不改文件。",
    principle:
      "8/4/1-bit 索引 BMP 有个调色板（每项 4 字节 B,G,R,A），像素只存索引号，颜色查调色板得到。信息常藏在调色板里。\n\n" +
      "本 op 解析 BMP 头 + dump 调色板，并跑多个隐写候选：\n" +
      "① 调色板 LSB：每项 B/G/R(可选 A) 最低位拼 bit 流 → ASCII（MSB/LSB 两种拼法）\n" +
      "② 索引顺序：正常调色板按亮度有序，非单调说明排列被打乱、可能编码信息\n" +
      "③ 相邻项差值 LSB：相邻项分量差的最低位\n" +
      "④ 未用索引：像素只用少数索引时，未用到的调色板项常单独藏数据\n" +
      "命中 flag{}/ctf{} 等模式会高亮汇总。",
    usage: "拖入 BMP 文件，或粘 hex/base64。可调 LSB 抽取通道顺序（默认 bgr）、dump 项数。输出各候选的 ASCII 预览 + flag 命中。仅分析。",
    examples: [
      { in: "（8-bit 索引 BMP 的 hex/base64）", param: "lsbChannels=bgr", out: "头信息 + 调色板 dump + 各隐写候选 + flag 命中" },
    ],
    tips: ["像素全用同一个索引时，真信息几乎必在调色板本身，重点看候选①③。", "BMP 调色板存储序是 B,G,R,A，通道顺序影响 LSB 拼接结果，拼不出就换 lsbChannels。"],
    aka: ["bmp调色板隐写", "bmp palette", "调色板隐写", "palette lsb", "bmp隐写", "调色板lsb",
      "索引bmp隐写", "bmp取证", "调色板分析", "bmp color table", "palette steganography", "位图调色板隐写"],
  },

  f5stego: {
    what: "F5 JPEG 隐写提取：从 F5 隐写的 JPEG 里用密钥抽出隐藏字节流。忠实移植 f5stegojs 库，只提取不嵌入。",
    principle:
      "F5 把数据藏在 JPEG 的 DCT 系数里（跳过 DC 系数）。提取流程：\n\n" +
      "1. 熵解码 JPEG 拿到各分量 DCT 系数（取亮度分量 Y）\n" +
      "2. 用密钥做 RC4 变体 PRNG 生成伪随机流，再 Fisher-Yates 置换系数顺序\n" +
      "3. 先抽 4 bit 定矩阵编码参数 k，再按 $(1, 2^k-1, k)$ 矩阵编码提取 hash → 字节流，全程 XOR gamma（keystream）\n" +
      "4. 按 2/3 字节长度头截取真实 payload\n\n" +
      "密钥是 F5 PRNG 的种子（f5stegojs 常用整数字节数组如 1,2,3,4,5,6,7，也支持口令/hex）。密钥错或非 f5stegojs 系样本，提出来的是噪声，长度头会显得离谱。",
    usage: "拖入 JPEG（或粘 hex/base64），填密钥。密钥格式可选：自动/整数列表/口令文本/hex。输出隐藏字节的 hex + ASCII + UTF-8 + F5 容量诊断 + flag 命中。仅提取。",
    examples: [
      { in: "（F5 隐写 JPEG）", param: "key=1,2,3,4,5,6,7 keyFormat=ints", out: "提取的字节流 hex/ASCII + 诊断" },
    ],
    tips: ["密钥和 keyFormat 都要对上，f5stegojs 常见写法是整数列表如 1,2,3,4,5,6,7。", "提取失败或长度头离谱，多半是密钥错，或该 JPEG 是原始 Java F5（口令派生不同，本 op 不解）。"],
    aka: ["f5隐写", "f5 jpeg", "f5stego", "f5stegojs", "jpeg隐写提取", "f5 steganography",
      "dct系数隐写", "f5提取", "jpeg dct隐写", "f5 extract", "矩阵编码隐写", "F5隐写"],
  },

  spectrogram: {
    what: "音频频谱图（STFT）：把 WAV 转成频谱图 PNG，肉眼就能看见画进音频频域的 flag/文字，免装 Audacity。CTF 音频隐写杀器。",
    principle:
      "标准短时傅里叶变换（STFT）：\n\n" +
      "1. 解析 WAV 取 PCM 单声道\n" +
      "2. 按帧长 fftSize 滑窗（hop = fftSize/2 半重叠），每帧加 Hann 窗抑制频谱泄漏\n" +
      "3. 每帧 radix-2 Cooley-Tukey FFT → 幅度谱，取前 fftSize/2 个 bin（Nyquist 内）\n" +
      "4. 幅度转 dB（$20\\log_{10}$），按动态范围归一 → magma 色阶 → 像素\n" +
      "5. 手写 PNG 编码，x = 时间帧、y = 频率（低频在下），输出 dataURL\n\n" +
      "出题人常把文字画在频域，普通播放听不出，但频谱图上看得见。",
    usage: "拖入 WAV（或粘 hex/base64/dataURL），选 FFT 帧长（默认 1024）、声道、动态范围底 dbFloor。输出频谱图 PNG dataURL + 参数摘要。仅分析。",
    examples: [
      { in: "（一段藏字的 WAV）", param: "fftSize=1024", out: "频谱图 PNG（能看到藏的文字）" },
    ],
    tips: ["频域藏字通常是横跨若干帧的亮色文字/波形，直接肉眼读。", "看不清调 dbFloor（调小=只留强信号对比更强）；高频细节丢失就增大 FFT 帧长。"],
    aka: ["频谱图", "spectrogram", "stft", "音频频谱", "短时傅里叶", "声谱图",
      "音频隐写频谱", "audio spectrogram", "频谱分析", "fft频谱", "sonic visualiser", "频域藏字"],
  },

 // ============ hash ============
  bcrypt: {
    what: "Bcrypt：OpenBSD 的口令哈希算法，基于 Blowfish，故意设计得慢（可调 cost 迭代），抗暴力破解。可生成也可校验。",
    principle:
      "核心是 EksBlowfishSetup（昂贵的密钥调度）：\n\n" +
      "1. 初始化 Blowfish 状态（π 常量）→ 用 salt + password 做 ExpandKey\n" +
      "2. 循环 $2^{cost}$ 次：交替 ExpandKey(0, password) 和 ExpandKey(0, salt)——cost 越大越慢\n" +
      "3. 反复加密魔术串 `OrpheanBeholderScryDoubt`（24 字节）64 轮\n" +
      "4. 取密文前 23 字节，用 bcrypt 变体 Radix-64（字母表 `./A-Za-z0-9`）编码\n\n" +
      "输出标准 modular crypt 格式：`$2b$<cost>$<22位salt><31位hash>`。bcrypt 只对 password 前 72 字节生效（含结尾 NUL）。",
    usage: "生成模式：输入口令，设 cost（4-31，默认 10）、盐（留空随机）、版本前缀（$2b$/$2a$/$2y$）。校验模式：输入口令 + 待校验的 $2b$... 串，输出匹配/不匹配。",
    examples: [
      { in: "password", param: "mode=hash cost=10", out: "$2b$10$...（60 字符）", desc: "盐随机则每次不同" },
    ],
    tips: ["看到 `$2a$`/`$2b$`/`$2y$` 开头、总长 60 字符的串，就是 bcrypt 哈希。", "cost 每 +1 计算量翻倍；口令超 72 字节的部分被忽略，这是标准行为不是 bug。"],
    aka: ["bcrypt", "Bcrypt", "布洛菲什哈希", "口令哈希", "密码哈希", "blowfish hash", "eksblowfish",
      "$2b$", "$2a$", "openbsd哈希", "bcrypt校验", "password hashing", "慢哈希"],
  },

  lmHash: {
    what: "LM Hash：Windows 早期（LAN Manager）的口令哈希，设计脆弱、极易破解，是渗透测试常见目标。",
    principle:
      "步骤：\n\n" +
      "1. 口令转大写，截断/补零到 14 字节\n" +
      "2. 拆成两个 7 字节半，各扩展成 8 字节 DES 密钥（每字节 7 位数据 + 1 奇偶位）\n" +
      "3. 分别用这两个密钥 DES-ECB 加密固定明文 `KGS!@#$%`\n" +
      "4. 两段 8 字节密文拼成 16 字节，输出大写 hex\n\n" +
      "致命弱点：口令强转大写（缩小空间）、按 7 字节独立处理（两半可分开爆破）、无盐。所以 LM Hash 几乎秒破。",
    usage: "输入口令，直接输出 32 字符大写 hex 的 LM Hash。单向。",
    examples: [
      { in: "password", out: "E52CAC67419A9A224A3B108F3FA6CB6D", desc: "口令先转大写再哈希" },
    ],
    tips: ["空口令的 LM Hash 固定是 `AAD3B435B51404EEAAD3B435B51404EE`，看到它说明该半段为空。", "因分两半独立、且强制大写，LM Hash 是历史上最好破的口令哈希之一，现代系统已弃用。"],
    aka: ["lm hash", "lmhash", "LM Hash", "lan manager hash", "windows lm", "局域网管理器哈希",
      "lm哈希", "des口令哈希", "KGS!@#$%", "lanman", "windows口令哈希", "LM散列"],
  },

  evpBytesToKey: {
    what: "EVP_BytesToKey：OpenSSL 从口令派生 key 和 IV 的老算法，`openssl enc -k` 用的就是它。CTF 里遇到 OpenSSL 加密的密文常需要它还原密钥。",
    principle:
      "迭代哈希拼接：\n\n" +
      "$D_1 = \\text{Hash}(pass \\| salt)$，$D_i = \\text{Hash}(D_{i-1} \\| pass \\| salt)$。\n\n" +
      "count > 1 时每块再哈希 count-1 次。把 $D_1, D_2, \\dots$ 拼接到长度 ≥ keyLen + ivLen，前 keyLen 字节当 key，紧接着 ivLen 字节当 IV。\n\n" +
      "默认哈希 MD5、count=1，这是 OpenSSL 历史默认（现已不推荐，但大量旧密文仍用）。",
    usage: "输入口令，填盐（8 字节 hex，可空）、key 字节数（如 AES-256 填 32）、iv 字节数（CBC 填 16）、迭代次数（默认 1）、哈希（MD5/SHA-1/SHA-256）。输出 Key 和 IV 的 hex。",
    examples: [
      { in: "password", param: "keyLen=32 ivLen=16 hash=md5", out: "Key: ...\nIV:  ...", desc: "AES-256-CBC 的派生参数" },
    ],
    tips: ["OpenSSL 密文以 `Salted__` 开头时，紧跟的 8 字节就是盐，填进来配口令即可还原 key/iv。", "默认 MD5 + count=1，对不上就试 SHA-256 或调迭代次数。"],
    aka: ["evpbytestokey", "evp_bytes_to_key", "EVP_BytesToKey", "openssl密钥派生", "openssl kdf", "openssl enc",
      "口令派生key", "evp派生", "openssl口令派生", "salted__", "密钥派生函数", "bytestokey"],
  },

 // ============ base ============
  dxBase64: {
    what: "DXBase64：风之暇想（thread-2058510）的 Base64 变体，带 CRC16 校验、每次密文不同、无需密钥（防和谐用）。",
    principle:
      "编码：原文 UTF-8 → raw deflate 压缩 → 生成 2 字节随机 salt，把压缩数据循环 XOR（第 i 字节 XOR salt[i%2]）→ 算 CRC16 校验（init 0xFFFF、多项式 0x1021）→ 组帧 `[crcHi, crcLo, salt0, salt1, ...xor数据]` → 标准 Base64。\n\n" +
      "解码：Base64 拆帧 → CRC16 校验（不匹配直接报错）→ salt 循环 XOR 还原 → raw inflate 解压。\n\n" +
      "随机 salt 让同一明文每次密文不同（防特征识别/和谐），CRC16 保证完整性，全程无密钥。",
    usage: "编码：输入文本，输出带校验的 Base64 串（每次不同）。解码：粘该串，CRC16 校验通过才还原。",
    examples: [
      { in: "hello", out: "（标准 Base64 串，每次不同）", desc: "含随机 salt" },
    ],
    tips: ["长得像普通 Base64 但同一文本每次编出来都不一样，且能自校验，多半是 DXBase64。", "CRC16 不匹配会报「数据校验失败」，说明密文被改过或不是 DXBase64。"],
    aka: ["dxbase64", "DXBase64", "dx base64", "风之暇想base64", "校验base64", "crc16 base64",
      "带校验base64", "防和谐base64", "随机盐base64", "dxb64", "base64变体", "风之暇想编码"],
  },

 // ============ classic / 古典密码 ============
  alberti: {
    what: "Alberti 圆盘密码：1467 年 Alberti 发明的多表替换鼻祖，两个同心圆盘（外盘明文、内盘密文），转动内盘就换一套替换表。",
    principle:
      "外盘刻标准 26 字母 A-Z，内盘刻一个 26 字母混合表（cipher alphabet）。\n\n" +
      "加密：字母在外盘定位到索引 i → 取内盘 $[(i + shift) \\bmod 26]$；解密反查。每处理 period 个字母，累计偏移 $shift \\mathrel{+}= periodicShift$——这就是「转动内盘」，让同一明文字母在不同位置映射到不同密文，是多表替换。periodicShift=0 时退化为单表。",
    usage: "参数：内盘 26 字母混合表（默认 QWERTZUIOPASDFGHJKLYXCVBNM）、初始偏移、周期转动步数（0=单表）、每几个字母转一次。非字母原样保留。",
    examples: [
      { in: "HELLO", param: "内盘默认 shift=0 转动=0", out: "按内盘单表替换的结果", desc: "转动=0 即单表" },
    ],
    tips: ["Alberti 是多表替换的祖师爷，比 Vigenère 早几十年，圆盘转动就是换表。", "转动步数设 0 就成了简单替换密码；设了才有多表强度。"],
    aka: ["alberti", "阿尔伯蒂圆盘", "alberti cipher", "圆盘密码", "阿尔伯蒂密码", "cipher disk",
      "多表替换鼻祖", "alberti disk", "同心圆盘密码", "阿尔贝蒂", "圆盘替换", "阿尔伯蒂圆盘密码"],
  },

  gematria: {
    what: "Gematria 数值密码：把字母按固定表换成数值，输出一串数字。收录英文、希伯来、希腊等多套体系。",
    principle:
      "本 op 走「逐字母数值序列」，保证可逆，可选行尾附整词总和 Σ。收录体系：\n\n" +
      "· English Ordinal：A=1…Z=26\n" +
      "· Pythagorean 数字根：1-9 循环（A=1…I=9, J=1…R=9, S=1…Z=8）\n" +
      "· English/Simple ×6：Ordinal×6，A=6…Z=156\n" +
      "· Reverse Ordinal：A=26…Z=1\n" +
      "· 希伯来 Mispar Hechrachi：א=1…ת=400\n" +
      "· 希腊 Isopsephy：α=1…ω=800\n\n" +
      "一一映射的体系完全可逆；数字根多对一（1←a|j|s），解码时给候选集如 (a|j|s)。",
    usage: "选体系，是否附总和 Σ。编码：文本→数字序列（词内空格分隔，词间 / 分隔，行尾可带 Σ=）。解码：数字串还原字母（数字根体系会标多解候选）。",
    examples: [
      { in: "hi", param: "mode=ordinal", out: "8 9  |  Σ=17", desc: "h=8 i=9，总和 17" },
    ],
    tips: ["Gematria 常和数字谜题/宗教文本联系，看到「字母=数值」的求和线索就想到它。", "数字根体系（reduction）不可唯一还原，解码会给出如 (a|j|s) 的多解。"],
    aka: ["gematria", "Gematria", "数值密码", "字母数值", "isopsephy", "希伯来数值", "希腊数值",
      "字母求和", "ordinal gematria", "gematria计算", "数字命理", "字母转数字", "gematria数值"],
  },

  nihilistCipher: {
    what: "Nihilist 密码：俄国民意党 1880 年代用的密码，Polybius 方阵 + 关键词加数。密文是一串数字。",
    principle:
      "1. 用方阵关键词构造 5×5 Polybius 方阵（关键词去重填入，I/J 合并，剩余字母按序补全）\n" +
      "2. 明文每字母 → 方阵的行号+列号，编成两位数（如 R=11、A=12）\n" +
      "3. 加密密钥同样用方阵编码成数字序列，循环使用\n" +
      "4. 密文 = 明文数字 + 密钥数字（整数相加，位置间独立不进位）\n\n" +
      "因是整数加法，密文可能是三位数（如 55+51=106）。解密：密文数字减去密钥数字，还原成行列查方阵。",
    usage: "填方阵关键词（构造 Polybius 方阵）和加密密钥。编码输出空格分隔的数字串。解码接受空格/逗号/顿号分隔的数字。J 会并入 I。",
    examples: [
      { in: "dynamitewinterpalace", param: "keyword=zebras key=russian", out: "37 106 62 36 67 ...", desc: "Wikipedia 官方向量" },
    ],
    tips: ["密文是一串 20-110 左右的数字（可能有三位数），且需要两个关键词，多半是 Nihilist。", "方阵 I/J 合并，明文里的 J 按 I 处理。"],
    aka: ["nihilist", "nihilist cipher", "虚无主义者密码", "尼希利斯特", "波利比乌斯加数", "俄国虚无党密码",
      "nihilist密码", "polybius加数", "虚无党密码", "尼希利斯特密码", "民意党密码", "nihilistcipher"],
  },

  solitaire: {
    what: "Solitaire 扑克流密码（又名 Pontifex）：Bruce Schneier 设计、《Cryptonomicon》里登场的手工流密码，用一副 54 张牌生成密钥流。",
    principle:
      "54 张牌：1-52 普通牌，53=大王(A)，54=小王(B)。每输出一个密钥流值前，牌堆演化四步：\n\n" +
      "1. 大王下移 1 位\n2. 小王下移 2 位\n3. Triple cut：以两王为界交换首尾两段\n4. Count cut：按底牌值把顶部若干张移到底牌之上\n\n" +
      "然后看顶牌值 n，取第 n+1 张的牌值当密钥流（王牌跳过重跑），映射到 1-26。加密：明文字母(1-26) + 密钥流 mod 26；解密：减。可用 keyword 预先排牌。",
    usage: "可选填 keyword 密钥（预排牌堆，留空用默认牌序）。编码/解码只处理字母，非字母忽略。",
    examples: [
      { in: "AAAAAAAAAA", param: "keyword 留空", out: "EXKYIZSGEH", desc: "Schneier 官方向量" },
    ],
    tips: ["典型手工密码，题面常出现扑克牌、大小王、《Cryptonomicon》等线索。", "keyword 只影响初始牌序；同 keyword 同长度密钥流固定，可对拍验证。"],
    aka: ["solitaire", "pontifex", "扑克密码", "纸牌密码", "solitaire cipher", "施奈尔密码",
      "扑克流密码", "纸牌流密码", "solitaire扑克", "cryptonomicon密码", "手工流密码", "54张牌密码"],
  },

  foursquarekw: {
    what: "Four-square 四方密码（keyword 版）：Playfair 家族的双字母替换密码，用两个关键词生成密文方阵 + 两个标准明文方阵，共四个 5×5 方阵。",
    principle:
      "四个方阵按 2×2 摆放：左上、右下是标准明文方阵，右上（keyword1）、左下（keyword2）是密文方阵。\n\n" +
      "加密双字母 (a,b)：a 在左上明文方阵定位 (r1,c1)，b 在右下明文方阵定位 (r2,c2)；密文1 = 右上方阵[r1][c2]，密文2 = 左下方阵[r2][c1]。解密反向。\n\n" +
      "字母表约定：5×5 只放 25 字母，可选「I/J 合并（去 J）」或「省略 Q」。Wikipedia 官方向量需用省略 Q 才能复现。明文奇数长补 X。",
    usage: "填关键词1（右上密文方阵）、关键词2（左下密文方阵）、字母表约定（I/J 合并 或 省略 Q）。双向。",
    examples: [
      { in: "helpmeobiwankenobi", param: "key1=EXAMPLE key2=KEYWORD 字母表=noq", out: "FYGMKYHOBXMFKKKIMD", desc: "Wikipedia 官方向量" },
    ],
    tips: ["四方比 Playfair 更强，因为用两个独立密文方阵，同明文字母对可映射到不同密文。", "复现 Wikipedia 官方例必须选「省略 Q」的字母表约定。"],
    aka: ["four-square", "foursquare", "四方密码", "four square cipher", "foursquarekw", "四方形密码",
      "四方关键词", "四格密码", "four-square cipher", "双字母替换四方", "playfair家族四方", "4方密码"],
  },

  twosquare: {
    what: "Two-square 双方密码（又称 double Playfair）：两个关键词方阵，横排或纵排，做双字母替换。是自反密码（编码解码同一操作）。",
    principle:
      "两个 keyword 生成的 5×5 方阵，横排（左|右）或纵排（上/下）。\n\n" +
      "纵排：a 在上方阵 (r1,c1)、b 在下方阵 (r2,c2)。同列(c1==c2)则原样输出 a,b；否则 out1=上[r1][c2]，out2=下[r2][c1]。\n\n" +
      "横排：a 在左方阵、b 在右方阵。同行则原样；否则交叉取字母。\n\n" +
      "因为变换对称，encode 和 decode 是同一个函数——自反。字母表可选 I/J 合并或省略 Q，明文奇数补 X。",
    usage: "填关键词1、关键词2、排列方向（纵排/横排）、字母表约定。编码解码同一操作（自反）。",
    examples: [
      { in: "HELP", param: "key1=EXAMPLE key2=KEYWORD 纵排", out: "双字母替换结果", desc: "再跑一遍还原" },
    ],
    tips: ["自反：同一参数下编码结果再编码一次就回到原文，不确定方向直接再跑一遍。", "纵排同列 / 横排同行的字母对会原样保留，这是 Two-square 的固有特性。"],
    aka: ["two-square", "twosquare", "双方密码", "two square cipher", "double playfair", "双方形密码",
      "双格密码", "two-square cipher", "双方关键词", "自反双字母密码", "双四方密码", "2方密码"],
  },

 // ============ radix ============
  bech32: {
    what: "Bech32 编码（BIP173）：比特币 SegWit 地址用的编码，HRP 前缀 + 数据 + BCH 校验和，能检测拼写错误。",
    principle:
      "结构：`HRP + '1' + data + 6 字符校验和`。HRP 是人类可读前缀（如 `bc` 主网、`tb` 测试网）。\n\n" +
      "data 部分：把 8 位字节流按每 5 位一组转换（$8 \\to 5$ 位打包），再用 32 字符字母表 `qpzry9x8gf...`（不含易混的 1/b/i/o）表示。\n\n" +
      "校验和是 BCH 码，多项式照 BIP173，能定位并检测少量字符错误。分隔符固定用 `1`（所以数据字母表不含 1）。",
    usage: "编码：输入 hex payload，填 HRP（默认 bc），输出 bech32 地址。解码：粘 bech32 串，校验通过后输出 hrp 和 payload hex。",
    examples: [
      { in: "751e76e8199196d454941c45d1b3a323f1433bd6", param: "hrp=bc", out: "bc1...（bech32 串）", desc: "20 字节 payload" },
    ],
    tips: ["小写、以 `bc1`/`tb1` 开头、只含 `qpzry9x8gf2tvdw0s3jn54khce6mua7l` 这些字符，就是 Bech32。", "校验和不通过说明地址拼错或损坏——这正是 Bech32 的设计目的。"],
    aka: ["bech32", "Bech32", "bip173", "比特币地址编码", "segwit地址", "bch校验编码", "bech32编码",
      "比特币bech32", "bip-173", "segwit address", "hrp编码", "闪电网络地址编码"],
  },

  uuidParse: {
    what: "UUID 解析：把一个 UUID 拆开看版本、变体，v1 还能读出时间戳和 MAC 地址，v7 读出 Unix 毫秒时间。RFC 4122。",
    principle:
      "UUID 是 128 位（32 hex，格式 8-4-4-4-12）。结构：time_low(32) - time_mid(16) - time_hi_and_version(16) - clock_seq(16) - node(48)。\n\n" +
      "版本 = time_hi_and_version 的高 4 位；变体 = clock_seq_hi 的高几位。\n\n" +
      "· v1：60 位时间戳（从 1582-10-15 起的 100ns 间隔）+ 48 位 MAC 地址——能泄露生成时间和网卡\n" +
      "· v4：随机（除版本/变体位）\n" +
      "· v3/v5：命名空间+名字的 MD5/SHA-1 哈希（不可逆推）\n" +
      "· v7：前 48 位是 Unix 毫秒时间戳",
    usage: "输入 UUID（带或不带连字符均可），输出版本、变体，以及 v1 的时间戳/MAC/时钟序列、v7 的时间戳。单向解析。",
    examples: [
      { in: "550e8400-e29b-41d4-a716-446655440000", out: "版本: v4 随机生成\n变体: RFC 4122...", desc: "v4 UUID" },
    ],
    tips: ["UUID v1 会泄露生成时间和 MAC 地址，CTF 里常靠它反推信息。", "版本号是第 13 个 hex 字符（第三段首位），一眼就能看出是 v1/v4/v7。"],
    aka: ["uuid", "uuidparse", "uuid解析", "guid", "rfc4122", "通用唯一标识符", "uuid parser",
      "uuid版本", "uuid v1", "uuid v4", "guid解析", "唯一标识符解析"],
  },

  varint: {
    what: "VarInt (LEB128)：Protobuf 用的变长整数编码，小整数占字节少。支持无符号和 ZigZag 有符号。用 BigInt 支持大数。",
    principle:
      "无符号 LEB128（ULEB128）：每字节最高位是 continuation（1=还有后续，0=结束），低 7 位是数据，小端序（低位字节在前）。\n\n" +
      "有符号用 ZigZag 先变换再 ULEB128：$n \\to (n \\ll 1) \\oplus (n \\gg 63)$，把小的负数也映射成小的正数（0→0, -1→1, 1→2, -2→3…），避免负数变成一大串字节。\n\n" +
      "解码反过来：先 ULEB128 拆字节，有符号再 ZigZag 还原。",
    usage: "编码：输入十进制整数，勾选是否 ZigZag 有符号，输出 hex 字节。解码：输入 hex，按同样的有符号设置还原整数。",
    examples: [
      { in: "300", param: "signed=false", out: "ac02", desc: "300 = 0xAC 0x02（小端 7 位组）" },
      { in: "-1", param: "signed=true", out: "01", desc: "ZigZag: -1→1→单字节 01" },
    ],
    tips: ["Protobuf 的 wire format 里整数字段全用 LEB128，逆向 protobuf 报文常要它。", "负数不勾 ZigZag 会报错（无符号不支持负数）；解码时有符号设置要和编码一致。"],
    aka: ["varint", "leb128", "LEB128", "变长整数", "protobuf整数", "uleb128", "zigzag编码",
      "protobuf varint", "变长编码", "变长int", "变长整型", "protobuf变长整数"],
  },

  primeGen: {
    what: "大素数生成：用 Miller-Rabin 素性检验生成指定位数的大素数，随机源用密码学安全的 CSPRNG。RSA 造题常用。",
    principle:
      "Miller-Rabin 概率素性检验（确定性版本）：把 $n-1 = d \\cdot 2^r$，对每个 witness a 检查 $a^d \\bmod n$ 是否为 1 或 $n-1$，或平方序列里出现 $n-1$。\n\n" +
      "对 $n < 3.3 \\times 10^{24}$ 用前 13 个质数（2,3,5,…,41）做 witness 即可确定性判定；更大的 n 用同样 13 个 witness，误判概率 $< 4^{-13}$，CTF 足够。\n\n" +
      "生成：crypto.getRandomValues 生成随机奇数（最高位、最低位置 1）→ Miller-Rabin 检验，不过就 +2 重试直到找到素数。",
    usage: "填位数（2-1024）和数量，输出对应的十进制素数（每行一个）。忽略输入文本。",
    examples: [
      { in: "（忽略）", param: "bits=64 count=1", out: "一个 64 位十进制素数（每次不同）", desc: "随机生成" },
    ],
    tips: ["RSA 造题要两个大素数 p、q，这个直接生成。", "随机源是 crypto CSPRNG 不是 Math.random，适合密码学用途。"],
    aka: ["素数生成", "primegen", "大素数生成", "miller-rabin", "米勒拉宾", "prime generator", "素性检验",
      "质数生成", "随机素数", "miller rabin", "素数生成器", "prime gen", "rsa素数"],
  },

  randomSeed: {
    what: "随机种子生成：用密码学安全的 CSPRNG（crypto.getRandomValues）生成随机字节，输出 hex 或 base64。",
    principle:
      "调用 crypto.getRandomValues 填充指定长度的字节数组——这是浏览器/Node 的密码学安全伪随机数生成器（CSPRNG），不是可预测的 Math.random。\n\n" +
      "生成后按选择的格式输出：hex（每字节两位十六进制）或 base64。适合当密钥、IV、salt、nonce、随机 token。",
    usage: "填字节数（1-4096）和输出格式（hex/base64），输出随机串。忽略输入文本。",
    examples: [
      { in: "（忽略）", param: "length=16 format=hex", out: "32 位 hex 随机串（每次不同）", desc: "16 字节随机" },
    ],
    tips: ["需要密钥/IV/salt/nonce 时用它，别用 Math.random（可预测、不安全）。", "16 字节=128 位，32 字节=256 位，按用途选长度。"],
    aka: ["随机种子", "randomseed", "随机字节", "csprng", "random seed", "随机数生成", "安全随机",
      "随机密钥", "getrandomvalues", "随机种子生成", "random bytes", "密码学随机", "随机token"],
  },
};
