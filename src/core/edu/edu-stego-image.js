// 科普内容分片：stego 图像类（LSB / 置乱 / 位平面 / PNG·JPEG·GIF 块解析）。纯数据，无 import 无副作用。
export default {
  pixelJihad: {
    what: "PixelJihad 隐写：进阶版 LSB——先用口令派生的伪随机序列决定「藏在哪些像素位」，还能可选套一层 AES-CCM 加密，比顺序 LSB 隐蔽得多。",
    principle:
      "用 SHA-256 把口令变成种子，喂给伪随机数生成器，决定隐藏比特分散到哪些像素的最低位（不是从头顺着排）。没口令就不知道读取顺序。开启 AES-CCM 时，藏入前先加密，取出后先解密。",
    usage: "编码：填口令（可选 AES 密钥）把消息散布进图片最低位。解码：同口令还原读取顺序取出消息。",
    examples: [
      { in: "一张 PNG + 口令", out: "隐藏消息", desc: "口令错则读出的位序全乱" },
    ],
    tips: ["顺序 LSB 扫不出东西、但题目暗示有隐写且给了口令 → 试 PixelJihad。像素改动分散，肉眼和常规 LSB 工具都难发现。"],
    aka: ["pixeljihad", "伪随机lsb", "口令lsb隐写", "PixelJihad", "密码lsb", "随机lsb隐写", "分散lsb", "aes-ccm lsb", "口令隐写", "伪随机位隐写"],
  },

  arnoldCat: {
    what: "Arnold 猫脸变换：一种把正方形图像像素「搅乱」的置换，反复搅够多次会神奇地还原成原图（周期性）。CTF 里用来打乱/复原隐藏图像。",
    principle:
      "对 N×N 图像每个像素坐标做线性变换 $(x,y)\\to(2x+y,\\ x+y)\\bmod N$，像素被搬到新位置。这个映射是双射且有周期 T——迭代 T 次后每个像素回到原位，图像复原。",
    usage: "输入正方形图像和迭代次数：正向置乱打乱图像；继续迭代到周期 T 即复原。",
    examples: [
      { in: "N×N 图像", param: "迭代 k 次", out: "置乱后的图像", desc: "再迭代 T−k 次还原" },
    ],
    formulas: [
      { tex: "\\begin{pmatrix}x'\\\\y'\\end{pmatrix}=\\begin{pmatrix}2&1\\\\1&1\\end{pmatrix}\\begin{pmatrix}x\\\\y\\end{pmatrix}\\bmod N", caption: "Arnold 猫脸变换矩阵" },
    ],
    tips: ["图像明显被块状打乱、且是正方形 → 试 Arnold。不知迭代次数就一直迭代，肉眼看到某次突然清晰就是复原点。"],
    aka: ["arnold变换", "猫脸变换", "arnold cat map", "图像置乱", "Arnold Cat Map", "阿诺德变换", "猫映射", "arnold scrambling", "像素置乱", "图像还原变换"],
  },

  imageBasic: {
    what: "图像基础操作合集：反色、翻转、通道分离、位平面提取等常规变换。misc 图像题的「先随手试一遍」工具箱。",
    principle:
      "对像素做基础运算：反色是 $255-v$；翻转是重排像素坐标；通道分离是只留 R/G/B 之一看单通道图案；位平面提取是抽某一比特位。很多题把 flag 藏在单通道或反色后才显形。",
    usage: "上传图像，选操作（反色/翻转/通道分离/位平面…），看变换后有没有露出隐藏内容。",
    examples: [
      { in: "一张图", param: "反色", out: "反色图，可能显出暗藏文字" },
    ],
    tips: ["拿到图像题先无脑过一遍：反色、分通道、看各位平面，flag 常藏在某个单通道或某个位平面里。"],
    aka: ["图像基础操作", "image basic", "反色翻转通道", "图像反色", "通道分离", "图像翻转", "image invert", "channel split", "灰度反转", "图像变换工具"],
  },

  pngText: {
    what: "PNG 文本块读写：PNG 能在 tEXt/zTXt/iTXt 这几种块里存文字元数据（作者、说明、注释）。flag 常年爱藏这。直接操作文件字节，不经画布。",
    principle:
      "PNG 由若干 chunk 组成，文本块有三种：tEXt（未压缩关键字+文本）、zTXt（zlib 压缩文本）、iTXt（支持 UTF-8/多语言，可压缩）。工具解析这些块读出文本，也能写入新文本块。",
    usage: "上传 PNG（base64 进出），读出所有文本块内容，或写入自定义关键字+文本。",
    examples: [
      { in: "带 tEXt 的 PNG", out: "关键字=Comment, 文本=flag{...}" },
    ],
    tips: ["strings 一下 PNG 常能瞟到 tEXt 明文；zTXt 是压缩的要解一层。看到 IHDR 后夹着 tEXt/zTXt/iTXt 就来读。"],
    aka: ["png文本块", "png text", "text", "ztxt", "itxt", "tEXt块", "zTXt块", "iTXt块", "png元数据", "png文本chunk"],
  },

  bitplaneSlicing: {
    what: "位平面分解：把图像每个像素某一个比特位单独抽出来，拼成一张只有 0/1 的黑白图。隐藏图案常只在某一个位平面里可见。",
    principle:
      "一个 8 位通道值有 8 个比特位（bit0 最低到 bit7 最高）。高位平面保留图像主要轮廓，最低位平面(bit0)通常看着像噪声——但如果被 LSB 隐写塞了规则数据，最低位平面就会显出文字/二维码等图案。彩色按 RGB 各通道分，灰度按亮度分。",
    usage: "上传图像，选通道和比特位（0=LSB..7=MSB），输出该位平面的黑白图。",
    examples: [
      { in: "一张图", param: "R 通道 bit0", out: "最低位平面黑白图，可能现出文字" },
    ],
    tips: ["逐个位平面看，尤其是各通道的 bit0/bit1。隐藏的二维码、文字、图案往往就藏在最低几个位平面。"],
    aka: ["位平面分解", "bitplane slicing", "位平面", "bit plane", "比特平面", "位平面提取", "bit plane slicing", "LSB位平面", "位平面隐写", "比特层分离"],
  },

  imageDiff: {
    what: "图像差异对比：拿两张图逐像素做运算（XOR/差值/加/与/或），把隐藏在「两图之差」里的图层逼出来。",
    principle:
      "有些题把 flag 藏在「原图 vs 改动图」的差异里，或分散在两张看似相同的图中。逐像素 XOR 能让相同部分归零、不同部分凸显；差值/位运算同理。相同的背景被抵消，隐藏层浮现。",
    usage: "上传两张同尺寸图（第二张传 p.image2），选运算（XOR/差/加/与/或），输出结果图。",
    examples: [
      { in: "图A + 图B", param: "XOR", out: "两图差异图，隐藏层显形", desc: "相同像素 XOR 为 0（黑）" },
    ],
    tips: ["题目给「两张几乎一样的图」→ 十有八九让你 XOR/相减找差异。尺寸必须一致才能逐像素对齐。"],
    aka: ["图像差异", "image diff", "图像异或", "双图对比", "图像对比", "image xor", "图片差异", "逐像素对比", "图像差值", "两图异或"],
  },

  pngChunkList: {
    what: "PNG 全块解析：把 PNG 里所有 chunk 列个清单（IHDR/PLTE/tEXt/IDAT/IEND 等），解析文本块和元数据。看 PNG 结构有没有异常、藏了什么。",
    principle:
      "PNG = 8 字节签名 + 一串 chunk，每 chunk 是「长度 + 类型 + 数据 + CRC」。IHDR 存宽高位深，IDAT 是像素数据，IEND 收尾，中间可能夹 tEXt/zTXt/iTXt/bKGD/iCCP 等。工具遍历列出每块类型、大小，解读文本与元数据。",
    usage: "上传 PNG，输出全部 chunk 清单 + 文本块内容 + 元数据。",
    examples: [
      { in: "一张 PNG", out: "IHDR, PLTE, tEXt(flag), IDAT×N, IEND" },
    ],
    tips: ["IEND 之后还有数据 → 文件尾追加了隐藏内容。异常/重复/位置不对的 chunk 都是线索。宽高和 IHDR 对不上考虑改高度题。"],
    aka: ["png块解析", "png chunk", "png结构", "chunk列表", "png chunk parser", "IHDR IDAT IEND", "png分块", "png结构解析", "png chunk list", "png文件结构"],
  },

  jpegAppList: {
    what: "JPEG APPn 段列举：JPEG 由一堆以 0xFF 开头的 marker 段组成，APP0-APP15 存元数据（JFIF/EXIF/ICC 等）。工具列出所有段，帮你找藏东西的地方。",
    principle:
      "JPEG 用 marker 分段：SOI(开始)、APP0(JFIF)、APP1(EXIF)、APP2(ICC)、DQT(量化表)、DHT(霍夫曼表)、SOF(帧)、COM(注释)、SOS(扫描数据)、EOI(结束)。工具遍历标出每个段的类型和内容概要。",
    usage: "上传 JPEG，输出全部 APPn 及其他 marker 段清单与内容标识。",
    examples: [
      { in: "一张 JPEG", out: "SOI, APP0(JFIF), APP1(EXIF), COM(注释), ..." },
    ],
    tips: ["COM 注释段、APP1 的 EXIF、EOI 之后追加的数据都是常见藏点。段结构错乱也可能是被改过的信号。"],
    aka: ["jpeg段", "jpeg app", "appn段", "jpeg marker", "jpeg marker解析", "APP0 APP1", "jpeg分段", "jfif exif段", "jpeg结构解析", "jpeg segment"],
  },

  gifComment: {
    what: "GIF 注释扩展：GIF89a 支持注释扩展块（0x21 0xFE），能存纯文本。flag 常被塞在这里。工具把所有注释拼出来。",
    principle:
      "GIF89a 的扩展块以 0x21 引导，注释扩展是 0x21 0xFE，后面跟若干 sub-block（每块以长度字节起头，0x00 结束）。工具找到注释扩展、拼接所有 sub-block 得到完整注释文本。",
    usage: "上传 GIF，输出注释扩展块里的全部文本。",
    examples: [
      { in: "一张 GIF89a", out: "注释文本 = flag{...}" },
    ],
    tips: ["GIF 题先看注释扩展；strings 也能瞟到。此外多帧 GIF 每帧可能各藏一块，配合 gifFrames 看。"],
    aka: ["gif注释", "gif comment", "注释扩展", "gif comment extension", "gif89a注释", "注释扩展块", "gif注释块", "0x21 0xFE", "gif隐藏文本", "comment extension"],
  },

  gifFrames: {
    what: "GIF 多帧提取：GIF 能存多帧动画，工具列出每帧的位置、尺寸、延迟、处置方法、透明色等。隐藏内容常分散藏在某几帧里。",
    principle:
      "GIF 每帧由图像描述符 0x2C 引导，带该帧的左上坐标、宽高、局部色彩表标志。图形控制扩展记录帧延迟和处置方法（画完是否清除）。工具解析这些找出每帧信息，便于逐帧查看。",
    usage: "上传多帧 GIF，输出各帧的位置/尺寸/局部色表/延迟/处置方法/透明色。",
    examples: [
      { in: "多帧 GIF", out: "帧0: (0,0) 100×100 延迟10; 帧1: ..." },
    ],
    tips: ["动图闪一下就过的某帧、或延迟为 0 的隐藏帧常藏 flag。逐帧拆开看，别只看第一帧。"],
    aka: ["gif帧", "gif frames", "多帧提取", "gif动画", "gif逐帧", "gif帧提取", "gif分帧", "animated gif frames", "gif多帧", "gif动图拆帧"],
  },

  iccStrip: {
    what: "ICC 剥离：把图像里的 ICC 色彩配置文件（PNG 的 iCCP 块 / JPEG 的 APP2 段）去掉，返回干净图。ICC 里有时被塞了隐藏数据。",
    principle:
      "ICC profile 是描述色彩空间的一段数据，PNG 放在 iCCP chunk、JPEG 放在 APP2 的 ICC_PROFILE 段。它体积可以很大，正好被拿来藏东西。工具定位并移除 ICC 段，输出去 ICC 后的 base64。",
    usage: "上传图像，输出剥离 ICC 后的图（base64）。剥离前可先看 ICC 段里有没有异常数据。",
    examples: [
      { in: "带 iCCP 的 PNG", out: "去 ICC 后的 PNG" },
    ],
    tips: ["ICC 段异常大 → 可能藏了数据，剥离前先 dump 出来查。此外剥 ICC 还能修某些「颜色显示不对」的题图。"],
    aka: ["icc剥离", "icc strip", "iccp", "色彩配置剥离", "ICC profile剥离", "iCCP块", "色彩配置文件", "icc profile strip", "去除icc", "icc色彩剥离"],
  },

  arnoldCatBrute: {
    what: "Arnold 猫脸暴破：当你不知道猫脸变换的参数（a/b/迭代次数）时，穷举全部组合逐个反向还原，把候选结果拼成一张网格图，肉眼扫一遍就能找到复原图。",
    principle:
      "参数化 Arnold 矩阵为 $\\begin{pmatrix}1&a\\\\b&ab+1\\end{pmatrix}\\bmod N$（行列式为 1，可逆）。正向 $\\begin{pmatrix}x'\\\\y'\\end{pmatrix}=M\\begin{pmatrix}x\\\\y\\end{pmatrix}$，反向用逆矩阵 $M^{-1}=\\begin{pmatrix}ab+1&-a\\\\-b&1\\end{pmatrix}$。暴力破解对 a、b、次数三个维度做嵌套遍历，每组参数把图逆变换并缩略排列到网格。",
    usage: "上传正方形图，设定 a/b/次数的起止范围（默认 a:1-3、b:1-3、次数:1-5 共 45 组合），输出候选网格图。组合数上限 2000，别贪大。",
    examples: [
      { in: "置乱图", param: "a:1-3 b:1-3 次数:1-5", out: "45 格候选网格图", desc: "复原图在网格中的某格" },
    ],
    formulas: [
      { tex: "M=\\begin{pmatrix}1&a\\\\b&ab+1\\end{pmatrix},\\ M^{-1}=\\begin{pmatrix}ab+1&-a\\\\-b&1\\end{pmatrix}\\pmod N", caption: "参数化 Arnold 矩阵与逆矩阵" },
    ],
    tips: ["题只给图没给参数 → 先默认范围扫一遍；出现边缘溢出/网格破碎的就是候选。a=b=1 是标准猫脸（退化情形）。图必须正方形。"],
    aka: ["arnold暴破", "猫脸暴破", "arnold brute force", "猫脸破解", "arnold参数破解", "猫脸暴力破解", "arnold穷举", "猫脸穷举", "arnold crack", "猫脸还原"],
  },

  stegpy: {
    what: "stegpy 隐写（stegv3）：stegpy 工具使用的隐写格式——把消息字节按位平面交错写进像素低位（1/2/4 位），帧头带 stegv3 魔数与长度，可选 PBKDF2+Fernet 密码加密。CTF 里 stegpy 藏过的图用它直接提。",
    principle:
      "宿主取图像 RGB 字节流（去 alpha，行序扁平）。位平面交错：设 divisor=8/bits，消息第 k 字节的每 bits 位组写入 host[k*divisor+i] 的低位（i=0..divisor-1），即字节流按 bits 位拆分后相隔 divisor 分布。首字节 bit4-5 存 bits 标记（1→0、2→16、4→32）。帧格式：`stegv3`(6B) + 消息长度(4B 大端) + 文件名长度(1B) + [文件名] + 消息。密码模式：PBKDF2-HMAC-SHA256 10 万次派生 32 字节密钥 → Fernet（AES-128-CBC+HMAC-SHA256）加密，salt 前置 16 字节。",
    usage: "编码：上传载体图，填要藏的文本与位数（1/2/4），可选密码。解码：上传 stegpy 藏过的图，填密码（若有）即提消息；带文件名时提示文件名。",
    examples: [
      { in: "载体 PNG + 文本", param: "bits=2", out: "藏密 PNG", desc: "肉眼不可见的低位扰动" },
      { in: "藏密 PNG", param: "密码（若有）", out: "隐藏消息/文件名", desc: "无密码提取报 stegv3 魔数缺失" },
    ],
    tips: ["stegpy 工具或教程题的图 → 直接本 op 提取，比通用 LSB 扫描靠谱。载体是 RGBA 时只取 RGB 三通道（与 stegpy 工具一致）。密码错会报 Fernet 校验失败。"],
    aka: ["stegpy", "stegv3", "stegpy隐写", "stegpy提取", "stegv3隐写", "stegpy解密", "stegpy steganography", "stegpy解码", "stegpy工具", "fern隐写"],
  },

  stereogramSolver: {
    what: "立体图求解：Autostereogram（单幅随机点立体图 SIRDS）把隐藏的深度信息编码在图案的水平重复周期里。把图像与自身做水平循环位移相减，正确 offset 下重复图案对齐处变暗、文字/形状的深度条纹显形。",
    principle:
      "对每个 offset：$\\text{diff}(x,y)=\\text{clip}(\\text{img}(x,y)-\\text{img}((x-\\text{offset})\\bmod w,\\ y),\\ 0,\\ 255)$（numpy.roll 语义的水平位移）。深度条纹 = 位移量与重复周期匹配的区域差为 0。offset 取 [-w/2, w/2]，自动扫描模式把各 offset 结果缩略拼成网格，肉眼找最清晰一张。",
    usage: "上传立体图。知道偏移就填 offset 单值精确解；不知道就留空自动扫描（默认 -32..32 步进 2），在网格图里找对比最强烈、文字最清楚的那格。",
    examples: [
      { in: "SIRDS 随机点图", param: "offset=周期值", out: "显形条纹图", desc: "暗条纹处即隐藏内容" },
      { in: "SIRDS 随机点图", param: "留空自动扫描", out: "网格候选图", desc: "最清晰格子的 offset 即周期" },
    ],
    tips: ["立体图题目基本都这个原理：图与自身平移相减。扫不到就调大扫描范围（步进可改 1）。无轮廓的随机点图也能出结果。"],
    aka: ["立体图", "autostereogram", "sirds", "立体图求解", "stereogram", "随机点立体图", "立体图隐写", "stereogram solver", "3d立体图", "魔眼图"],
  },
};
