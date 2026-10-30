/*
 * edu-r18.js — R18 四个新 op 的中文科普卡候选（纯数据，无 import / 无副作用）。
 * 样例全部来自本项目实跑：R6 verify_lsbdeep.mjs、R10 verify_r10.mjs、R8 verify_thumb.mjs、
 * R18 verify_r18.mjs；未编造不存在的性质或输出。
 * M 归并建议：复制到 src/core/edu/edu-r18.js，在 eduContent.js 的 Object.assign 列表加 EDU_R18。
 */
export default {
  // ==================== LSB 深度扫描 ====================
  lsbDeep: {
    what:
      "LSB 深度扫描（lsbDeep）——把 PNG/BMP 像素的最低位按「通道组合 × 位平面 × 行/列优先 × " +
      "MSB/LSB 位序 × 起始偏移」全部枚举一遍，挑出最像隐藏文本/flag 的候选。它和普通 LSB 提取的区别是" +
      "不只默认看 bit0、也不只按行优先：列优先、MSB-first 和 1..7 bit 的起始偏移都参与搜索。",
    principle:
      "**位平面**：真彩色每个通道一个字节，bit0 是最低位（LSB），bit7 是最高位。LSB 隐写通常改 bit0，" +
      "但出题人也可以改 bit1..bit7，或把多个通道交错取位。\n\n" +
      "**组合枚举**：本工具覆盖通道 `r/g/b/a/rgb/bgr/rgba/bgra` × 位平面 0..7 × 行/列优先 × " +
      "MSB-first/LSB-first 拼字节 × 起始偏移 0..7，共 8×8×2×2×8 = 2048 组（默认全跑）。" +
      "每组先抽 768 B 探测前缀（大图 384 B），按可打印率、ASCII 率、字母比例、连续可读长度、" +
      "flag/Base64/URL 形态打分，再对靠前候选重抽 8192 B 精排。\n\n" +
      "**为什么需要偏移**：有些题目不是从第一个像素开始写，而是先跳过 1..7 个 bit；只看 offset=0 会漏。\n\n" +
      "**排序**：命中 flag 的候选直接 +1000 分并排最前；其次 Base64/URL 形态；最后才是可读性分数。" +
      "恒色块、周期重复、低多样性填充会被当作噪声丢掉，避免把纯色图刷屏。",
    usage:
      "把 PNG/BMP 拖进输入框（本 op 只接受原始字节，不接受文本粘贴），直接点「解码」。\n\n" +
      "参数：`channels`（all 或 b,r,g,a,rgb,bgr,rgba,bgra）、`bits`（all / 0-7 / 0,1,2）、" +
      "`orders`（msb,lsb）、`scans`（row,col）、`offsets`（0-7）、`limit`（返回候选数，默认 20）、" +
      "`maxPixels`（单图像素上限，默认 16000000）。\n\n" +
      "结果先列命中的 flag，再列 Top 候选（通道/位/位序/方向/偏移/分数 + 文本片段）。" +
      "要精确复现某个候选，把对应 channels/bits/orders/scans/offsets 填成单项再跑一次。",
    examples: [
      {
        in: "资料/软件测试用文件/LSB-AsianCheetah.png（600×450 RGBA PNG）",
        param: "默认 channels=all, bits=0-7, orders=msb,lsb, scans=row,col, offsets=0-7",
        out: "Top1 = B/bit0 MSB-first 行优先 off0，score=1225.6，命中 SharifCTF{e8e12db2fc654f3b50f3da4901ab986e}",
        desc: "R6 verify_lsbdeep.mjs 实跑：2048 组合、1216 条候选，flag 排第 1；R18 verify 再次命中",
      },
      {
        in: "同一张 LSB-AsianCheetah.png",
        param: "默认参数",
        out: "扫描耗时约 157–189 ms，返回候选 20 条（模块默认 limit=40 时为 40 条）",
        desc: "性能与限额实测；大图 >1MP 自动缩短探测前缀并减少候选数，>16MP 直接拒绝",
      },
      {
        in: "4 字节 01 02 03 04（非图片）",
        param: "默认参数",
        out: "未提取到有效候选：输入为空或不是图片字节",
        desc: "非 PNG/BMP 明确失败，不把二进制噪声冒充文本",
      },
    ],
    formulas: [
      {
        tex: "b_i = \\left( p_{c,i} \\gg k \\right) \\bmod 2",
        caption: "第 i 个像素、通道 c、位平面 k 上取出的一个 LSB",
      },
      {
        tex: "\\text{byte}_j = \\sum_{t=0}^{7} b_{8j+t} \\cdot 2^{7-t}\\quad(\\text{MSB-first})",
        caption: "按 MSB-first 把 8 个 bit 拼成一个字节；LSB-first 则把指数顺序反过来",
      },
    ],
    tips: [
      "认题：图片在 StegSolve 里换通道/位平面能看到文字，或题目提示「LSB」「最低位」「zsteg」，先用本 op 全扫；比手工逐个通道点快。",
      "B 通道 bit0、MSB-first、行优先、offset=0 是最常见的出题姿势；LSB-AsianCheetah 正是这一组。",
      "JPEG 是有损压缩，DCT 量化会破坏像素 LSB 的稳定性；本 op 只支持 PNG/BMP，JPEG 请用 jsteg/f5/outguess 等系数域 op。",
      "列优先（col）在方形图上常与行优先结果不同；如果行优先全是噪声，把 scans 改成 col 再试。",
      "偏移 1..7 很便宜，默认全跑；如果已知从第 N 个 bit 开始，直接填 offsets=N 可以把扫描量降到 1/8。",
      "flag 候选排第一是评分设计，不代表其余候选都无意义；Base64/URL 形态的候选也值得点开看。",
      "来源与限制：R6 `verify_lsbdeep.mjs` 45/0；默认 16MP 像素上限、单候选 4096 字符；与 zstegScan 的差异是支持列优先、MSB/LSB 位序和 0..7 偏移。",
    ],
    aka: [
      "LSB 深入分析", "LSB 深度扫描", "LSB 全通道扫描", "LSB 位平面分析", "LSB 多偏移扫描",
      "LSB 列优先", "LSB MSB-first", "LSB bit plane scan", "LSB deep scan", "LSB stego analysis",
      "zsteg 替代", "LSB 隐写提取", "最低有效位分析", "逐位平面提取", "LSB 比特序",
    ],
  },

  // ==================== 光栅隐写拆图 ====================
  rasterStego: {
    what:
      "光栅隐写拆图（rasterStego）——复刻 zbRasterTerminator：把一张图按宽/高的因数 d 和相位 phase " +
      "拆成多张「只保留 x % d == phase（或 y % d == phase）」的相位图。隐藏的文字/图案往往只在某一个" +
      "相位上才完整，肉眼直接看原图看不出来。",
    principle:
      "**拆图规则**：对宽 W 的每个因数 d（2..maxDivisor），生成 d 张图：第 phase 张只保留列 " +
      "`x % d == phase`，其余列清零；对高 H 同理只保留行 `y % d == phase`。文件名 `x-d-(phase+1).png`" +
      " 的第三段是 1 基相位，内部 phase 字段是 0 基。\n\n" +
      "**因数顺序**：复刻参考 Python 的 `output.insert(1, x)`，所以 600 的因数是 " +
      "`[2,10,8,6,5,4,3]`——2 固定在前，其余逆序，而不是升序。\n\n" +
      "**填充**：源图带 alpha 时默认透明填充（被清掉的像素 alpha=0），否则黑色填充；" +
      "这样拆出来的相位图不会把空白误当成黑块。\n\n" +
      "**为什么有效**：如果题目把文字按固定间隔（如每 5 列取 1 列）写进图片，原图看起来是完整图像，" +
      "但按 d=5、phase=0 拆开后，保留下来的像素正好拼出文字；其余像素被清零后文字更醒目。",
    usage:
      "把 PNG/BMP 拖进输入框（本 op 只接受原始字节），点「解码」。\n\n" +
      "参数：`maxDivisor`（2..64，默认 10，参考实现默认 2..10）、`both`（默认 true，同时拆 x/y）、" +
      "`axes`（both=false 时生效，x,y / x / y）、`fillMode`（auto/black/transparent）、`maxImages`（默认 128）、" +
      "`maxPixelsPerImage`（默认 8,000,000）、`maxTotalPixels`（默认 64,000,000）。\n\n" +
      "结果会列出每张相位图的文件名和尺寸，并把每张 PNG 作为可下载文件返回；" +
      "先看文件名里的 d 与 phase，再逐张预览找文字。",
    examples: [
      {
        in: "资料/软件测试用文件/光栅图demo.png（600×300 RGBA PNG）",
        param: "默认 maxDivisor=10, both=true, fillMode=auto",
        out: "共 68 张：x 轴 38 张、y 轴 30 张；x-5-1.png 存在（axis=x, divisor=5, phase=0）",
        desc: "R10 verify_r10.mjs 49/0 实跑；x-5-1 的 5×5 采样拼出 Password is here!",
      },
      {
        in: "同一张光栅图demo.png",
        param: "maxImages=10",
        out: "明确失败：RASTER_LIMIT_IMAGES，产物数量 68 超过上限 10，不静默截断",
        desc: "资源上限的失败语义：超限报错并给出因数，绝不只返回前 10 张假装成功",
      },
      {
        in: "2×2 24 位 BMP（R10 合成用例）",
        param: "默认参数",
        out: "x 轴 2 张 + y 轴 2 张 = 4 张，产物都是 PNG",
        desc: "BMP 输入也走同一套拆图与 PNG 编码，24 位 BGR 顺序已校正",
      },
    ],
    formulas: [
      {
        tex: "\\text{keep}_x(x,y) = [x \\bmod d = phase],\\qquad \\text{keep}_y(x,y) = [y \\bmod d = phase]",
        caption: "x/y 两个轴的相位掩码；不满足的像素清零（或透明）",
      },
      {
        tex: "\\text{output.insert}(1, d) \\Rightarrow [2, d_{\\max}, \\ldots, d_{\\min}]",
        caption: "参考 Python 的因数顺序复刻：2 固定在前，其余逆序",
      },
    ],
    tips: [
      "认题：题目给一张「看起来正常但局部有规律条纹」的图，或提示「光栅」「栅格」「raster」「相位」，先跑本 op。",
      "文件名 `x-5-1.png` 表示 x 轴、因数 5、第 1 个相位（0 基 phase=0）；不是「第 5 张」。",
      "x 轴和 y 轴都要看：文字可能按列间隔写，也可能按行间隔写；both=false 时默认只看 x，记得手动切 y。",
      "源图带 alpha 时默认透明填充；如果拆出来一片黑，试 fillMode=black 或 transparent 对比。",
      "产物多时先看 d 小的（2、3、5、10）；d 越大图越稀疏，文字可能只剩几列。",
      "资源上限是硬限制：`maxImages` 默认 128，`maxTotalPixels` 默认 64M；超限会报 RASTER_LIMIT_*，不会卡死浏览器。",
      "来源与限制：R10 `verify_r10.mjs` 49/0；参考实现 `资料/参考/反编py/zbCrypto/zbCrypto.zbRasterTerminator.py`；本 op 纯 JS、零 DOM。",
    ],
    aka: [
      "光栅隐写", "光栅图拆图", "zbRasterTerminator", "光栅终止器", "相位拆图",
      "x/y 相位图", "光栅扫描隐写", "栅格隐写", "raster stego", "raster terminator",
      "phase decomposition", "divisor phase images", "光栅图分离", "列/行相位拆图", "栅格拆图",
    ],
  },

  // ==================== MP3Stego 解码 ====================
  mp3stego: {
    what:
      "MP3Stego 解码（mp3stego）——按 MP3Stego 1.1.19 的 `-X -P` 解码流程，用密码从 MP3 的 " +
      "MPEG-1 Layer III 帧里取出隐藏数据：`part2_3_length` 的奇偶性承载 1 bit，密码决定哪些 " +
      "granule/channel 参与，取出的字节再经 3DES-CBC 解密和 gzip 解压还原文本/文件。",
    principle:
      "**选位**：每个 Layer III 帧的 side info 里有 `part2_3_length`；编码器把隐藏 bit 写进它的奇偶性。" +
      "解码端用 `SHA1(password)` 作为伪随机源，按 32 位字 LSB-first 取 bit；每 5 个 32 位字后重新 " +
      "`SHA1(hash_words_hostLE || password)`，累计 3 个 0 后丢弃下一个 0。被选中的 `part2_3_length` " +
      "最低位就是隐藏流的一个 bit。\n\n" +
      "**负载格式**：隐藏流前 4 字节是小端 `size_t` 的负载长度 lData，随后 lData 字节是 " +
      "3DES-CBC 密文（三个 8 字节密钥取自 `SHA1(password)` 的主机字节序偏移 0/6/12，IV=0）。" +
      "解密后去掉 3DES 尾部填充（最后一块最后一字节 = 有效字节数 rem），再按 gzip 解压。\n\n" +
      "**失败语义**：如果 3DES 后不是 gzip 头，说明密码错或文件未嵌入，明确报错；" +
      "不会把随机字节当明文返回。MPEG-2/2.5 LSF 帧的 side info 布局不同，本实现只验证了 MPEG-1，" +
      "遇到 LSF 会直接报 `MP3STEGO_LSF_UNVERIFIED`，不假成功。",
    usage:
      "把 MP3 拖进输入框（本 op 只接受原始字节），填编码时用的密码，点「解码」。\n\n" +
      "参数：`password`（-P 口令）、`extract`（默认 true；false 时只提取 3DES 密文负载，不解密不 gunzip）、" +
      "`maxPayloadBytes`（默认 4 MiB）。\n\n" +
      "成功时输出明文、UTF-8 长度和元数据（帧数、候选位数、隐藏长度）；" +
      "`extract=false` 时返回 `mp3stego-payload.bin` 供进一步分析。密码错误、空密码、非 MP3、LSF 帧都会给出明确错误码。",
    examples: [
      {
        in: "资料/工程留存/R10/_assets/a.mp3",
        param: "password=ILOVEYOUYOULOVEME, extract=true",
        out: "flag{1251_521_m1xueb1n9chen9ti@nm1mi}（明文 37 字节；233 帧、931 个候选位、隐藏负载 64 字节）",
        desc: "R10 verify_r10.mjs 与官方 mp3stego_Decode.exe oracle 逐字一致；R18 verify 再次命中",
      },
      {
        in: "同一 a.mp3",
        param: "password=wrong",
        out: "解码失败（MP3STEGO_BAD_PADDING 或 MP3STEGO_NOT_GZIP），不返回明文、不产生文件",
        desc: "错误口令明确失败；3DES 填充或 gzip 头任一不对就停，绝不给假成功",
      },
      {
        in: "同一 a.mp3",
        param: "password=（空字符串）",
        out: "解码失败，错误信息说明密码不匹配/未嵌入",
        desc: "空口令与错误口令走同一失败路径",
      },
      {
        in: "4 字节 01 02 03 04",
        param: "password=x",
        out: "MP3STEGO_NOT_MP3：不是 MP3 帧流（缺少 ID3/0xFFEx 同步头）",
        desc: "非 MP3 输入在解析前就被拒绝",
      },
    ],
    formulas: [
      {
        tex: "\\text{bit}_t = \\text{part2\\_3\\_length}_{f,g,c} \\bmod 2",
        caption: "被密码 PRNG 选中的帧/granule/channel 的 part2_3_length 奇偶位",
      },
      {
        tex: "P = \\mathrm{3DES\\text{-}CBC}_{K_1,K_2,K_3}(C),\\qquad M = \\mathrm{gunzip}(P[0:|P|-8+rem])",
        caption: "3DES-CBC 解密后按末字节 rem 去掉填充，再 gzip 解压",
      },
    ],
    tips: [
      "认题：题目给 MP3、提示「mp3stego」「-X -P」「音频隐写」，或压缩包里带 mp3stego 编码器，先用本 op 配密码试。",
      "密码区分大小写和空格；`ILOVEYOUYOULOVEME` 这类长口令要原样复制，别多敲换行。",
      "错误口令通常报 `MP3STEGO_BAD_PADDING` 或 `MP3STEGO_NOT_GZIP`；如果报 `MP3STEGO_LSF_UNVERIFIED`，是 MPEG-2/2.5 帧，不是密码问题。",
      "`extract=false` 只取加密负载，适合先用它确认「到底有没有隐藏数据」，再换密码解 3DES。",
      "隐藏长度 lData 有 4 MiB 上限；超限会报 `MP3STEGO_PAYLOAD_LIMIT`，不会分配超大内存。",
      "实现依赖编码器的 32 位 size_t 和小端主机序；官方 32 位 Windows/Linux 构建满足，其他构建可能对不上。",
      "来源与限制：R10 `verify_r10.mjs` 49/0 + exe oracle；算法按 MP3Stego 1.1.19 源码复刻，未调用外部 exe。",
    ],
    aka: [
      "MP3Stego", "MP3 隐写", "MP3 隐写解码", "mp3stego -X -P", "MP3Stego 解码",
      "MP3 音频隐写", "MP3 最低有效位", "part2_3_length 隐写", "MP3 steganography",
      "mp3 stego decode", "MP3Stego extract", "MP3 隐藏数据", "音频隐写 MP3",
      "MP3Stego 密码", "mp3stego.exe",
    ],
  },

  // ==================== EXIF 缩略图提取 ====================
  imageThumb: {
    what:
      "EXIF 缩略图提取（imageThumb）——从 JPEG 的 APP1（EXIF）里找 IFD1 指向的内嵌缩略图，" +
      "从 APP0（JFIF）里找 3×W×H 的裸 RGB 缩略图，从 PNG 的 eXIf chunk 里找 TIFF 缩略图。" +
      "很多题目把 flag/密码藏在缩略图里，主图完全看不出来。",
    principle:
      "**JPEG EXIF**：APP1 段以 `Exif\\0\\0` 开头，后面是 TIFF 头（II/MM + 42 + IFD0 偏移）。" +
      "IFD0 的 next IFD 就是 IFD1；IFD1 里 tag `0x0201` 是缩略图偏移、`0x0202` 是长度，" +
      "按这两个值从 TIFF 数据里切出缩略图字节。\n\n" +
      "**JFIF APP0**：APP0 头里 `Xthumbnail`/`Ythumbnail` 给出宽高，后面紧跟 3×W×H 的 RGB 原始像素；" +
      "本工具把它编码成 PNG 返回。\n\n" +
      "**PNG eXIf**：PNG 的 `eXIf` chunk 里放的是 TIFF 结构，解析方式与 EXIF 相同。\n\n" +
      "**边界**：只解析这三种标准位置，不做任意尾部/块间 carving；没有缩略图就明确说「未发现」，" +
      "不会把主图或随机 JPEG 片段冒充缩略图。",
    usage:
      "把 JPEG/PNG 拖进输入框（本 op 只接受原始字节），点「解码」。\n\n" +
      "参数：`maxCount`（最多返回张数，默认 8）、`minBytes`（过滤小于该字节数的缩略图，默认 0）。\n\n" +
      "结果列出每张缩略图的来源（EXIF IFD1 / JFIF APP0 / PNG eXIf）、MIME、宽高和字节数，" +
      "并把缩略图作为可下载文件返回；文件名默认 `image-thumb-1.jpg`，可用 rawFileName 改前缀。",
    examples: [
      {
        in: "资料/软件测试用文件/misc22-缩略图.jpg",
        param: "默认 maxCount=8, minBytes=0",
        out: "1 张：EXIF IFD1 | image/jpeg | 300×50 | 8201 B",
        desc: "R8 verify_thumb.mjs 46/0 与 PIL 对拍一致；R18 verify 再次确认 8201 B",
      },
      {
        in: "资料/软件测试用文件/014.jpg",
        param: "默认参数",
        out: "未发现内嵌缩略图：未发现 EXIF/JFIF 内嵌缩略图",
        desc: "没有缩略图时明确说明，不抛异常、不伪造文件（R2 回归要求 014 不崩）",
      },
    ],
    formulas: [
      {
        tex: "\\text{thumb} = \\text{TIFF}[\\text{offset}_{0x0201}:\\text{offset}_{0x0201}+\\text{len}_{0x0202}]",
        caption: "EXIF IFD1 的缩略图偏移/长度；JPEG 缩略图以 FF D8 开头",
      },
      {
        tex: "\\text{JPEG APP1} = \\text{Exif}\\backslash 0\\backslash 0 \\| \\text{TIFF}(\\text{II/MM}, 42, \\text{IFD0})",
        caption: "APP1 段的结构；IFD0 的 next IFD 指向 IFD1",
      },
    ],
    tips: [
      "认题：题目说「缩略图」「thumbnail」「EXIF 里还有一张图」，或主图与预览图不一致，先跑本 op。",
      "EXIF 缩略图可能与主图内容完全不同（出题人只改缩略图），放大缩略图看文字/flag。",
      "JFIF APP0 的缩略图是裸 RGB，不是 JPEG；本工具自动转 PNG，下载后可直接看。",
      "014.jpg 这类没有 IFD1 的文件会明确返回「未发现」，不是解码失败；换其他文件再试。",
      "只支持 JPEG/PNG 的标准缩略图位置；如果缩略图被塞在文件尾部或自定义 chunk，本 op 不负责 carving，请用 binwalk/foremost。",
      "来源与限制：R8 `verify_thumb.mjs` 46/0；PIL 对拍 misc22 为 300×50 / 8201 B；`014.jpg` 无缩略图且不崩。",
    ],
    aka: [
      "EXIF 缩略图", "EXIF 缩略图提取", "内嵌缩略图", "JPEG 缩略图", "IFD1 缩略图",
      "JFIF 缩略图", "PNG eXIf 缩略图", "EXIF thumbnail", "embedded thumbnail",
      "thumbnail extract", "EXIF 预览图", "JPEG APP1 缩略图", "缩略图检测",
      "EXIF 缩略图查看", "EXIF thumbnail recovery",
    ],
  },
  stegSolve: {
    "what": "StegSolve 图像分析台：把 CTF 常见的通道/位平面、LSB 数据提取、GIF 帧浏览、双图合并和立体图求解集中到一个页面。读入 PNG/BMP/JPEG/GIF 后可连续切换 42 种像素变换、按通道/位/位序/行序提取数据，并直接保存中间图，省去在多个脚本之间来回切换。",
    "principle": "**通道/位平面变换**：对每个像素通道做位运算、通道交换、灰度/反色/异或等 42 种变换；同一张图在不同通道或位平面上常能直接看到文字/二维码。\n\n**Data Extract**：按通道、位平面、位序（MSB/LSB）、行/列扫描和起始偏移拼字节，输出 hex/ASCII/UTF-8；适合手工确认 LSB 隐写，而不是只依赖自动扫描。\n\n**Frame Browser**：GIF 多帧逐帧查看、保存单帧，处理帧间差异/帧注释类题。\n\n**Image Combiner**：两张图按 13 种算术/位运算合并，常用于找差异、抵消封面或还原叠加图。\n\n**Stereogram Solver**：按视差偏移搜索自动立体图，输出隐藏深度图。",
    "usage": "从首页搜索或图像分析入口打开 StegSolve，拖入图片（或点选文件）。先在变换列表逐个切换通道/位平面；需要精确取数据时打开 Data Extract，设置通道、位平面、位序、行/列扫描和偏移后提取；GIF 用 Frame Browser，双图用 Image Combiner，立体图用 Stereogram Solver。所有操作在浏览器本地完成。",
    "examples": [
      {
        "in": "LSB-AsianCheetah.png（600×450 RGBA PNG）",
        "param": "Data Extract：B 通道 / bit0 / MSB-first / row / offset=0",
        "out": "提取到 SharifCTF{e8e12db2fc654f3b50f3da4901ab986e}",
        "desc": "R6 verify_lsbdeep.mjs 的同一实战样本；StegSolve 用于手工复核通道/位序/偏移。"
      },
      {
        "in": "GIF 多帧图片",
        "param": "Frame Browser",
        "out": "逐帧缩略图 + 单帧保存；可定位仅某一帧出现的文字/二维码。",
        "desc": "帧序和帧延时来自 GIF 原始结构，不重编码。"
      },
      {
        "in": "两张同尺寸图片",
        "param": "Image Combiner：XOR / 13 种模式",
        "out": "合并结果可直接预览/保存，用于找差异或还原叠加层。",
        "desc": "两图尺寸不一致时拒绝并提示，不静默缩放。"
      }
    ],
    "formulas": [
      {
        "tex": "b = (p_c \\gg k) \\bmod 2",
        "caption": "通道 c 的像素 p 取第 k 位（bit0=LSB）"
      },
      {
        "tex": "I_{out}(x,y) = I_A(x,y) \\oplus I_B(x,y)",
        "caption": "Image Combiner 的 XOR 模式示例"
      }
    ],
    "tips": [
      "先逐通道/位平面看，不要一上来只跑 LSB 自动扫描；很多题的文字只在某个通道的 bit0 或 bit1 出现。",
      "Data Extract 的位序和行/列扫描必须与出题脚本一致；MSB-first 与 LSB-first 结果会完全不同。",
      "JPEG 的像素已被有损压缩破坏，像素 LSB 提取通常无效；JPEG 题优先看 jsteg/F5/OutGuess 等系数域工具。",
      "GIF 题先看帧数和每帧延时，再逐帧保存；帧间差异可能才是隐藏信息。",
      "立体图先估视差范围，再让 Stereogram Solver 搜索；偏移范围过大会明显变慢。",
      "所有结果都留在本地，不会上传图片；保存中间图后再用其他 op 继续分析。"
    ],
    "aka": [
      "StegSolve",
      "Stegsolve",
      "stegsolve",
      "StegSolve 图像分析",
      "图像通道分析",
      "位平面分析",
      "bit plane",
      "LSB 手工提取",
      "Data Extract",
      "Frame Browser",
      "GIF 帧浏览",
      "Image Combiner",
      "图像合并",
      "Stereogram Solver",
      "立体图求解",
      "CTF 图片隐写",
      "通道切换",
      "隐写图像查看器",
      "stegsolve jar",
      "StegSolve 替代"
    ]
  },
  knnClassify: {
    "what": "KNN 最近邻分类：读取训练 CSV（带 A/B 标签）和待检测 CSV，按欧氏/曼哈顿距离取最近的 k 个样本投票，输出每条待检测记录的预测分类与统计。用于新能源车等表格数据的本地分类题。",
    "principle": "**距离**：欧氏距离取平方和开方，曼哈顿距离取各维绝对差之和；只用数值特征列。\n\n**投票**：取最近 k 个训练样本，A/B 票数比较；票数相同时按 `tieBreak` 处理（A、B 或报错）。\n\n**输入约定**：训练集首列或指定列为 A/B 标签，其余数值列为特征；待检测集没有标签，首列可作 ID。CSV 表头自动识别，BOM 兼容。",
    "usage": "打开 `KNN 最近邻分类` op，把待检测 CSV 放入输入框，参数中粘贴训练集 CSV 文本，设置 k、距离和 tieBreak 后运行。输出每条预测、A/B 计数和对比；适合新能源车检测数据等二分类题。",
    "examples": [
      {
        "in": "训练集：新能源汽车检测数据.csv（A/B 标签 + 4 个数值特征）；待检测：待检测新能源车.csv",
        "param": "k=1, metric=euclidean",
        "out": "336 条预测：A=180 / B=156；对应 flag{e0f095bd-16e6-4bf5-a1c5-3dce1d693aa5}",
        "desc": "题库两份真实 CSV 的 headless 浏览器实测结果。"
      },
      {
        "in": "k=3, metric=manhattan",
        "param": "tieBreak=error",
        "out": "输出每条投票统计；平票时明确报错而不是静默选边。",
        "desc": "异常面：k 大于训练行数、特征维度不一致、标签非 A/B 都会报错。"
      }
    ],
    "formulas": [
      {
        "tex": "d(x,y)=\\sqrt{\\sum_i (x_i-y_i)^2}",
        "caption": "欧氏距离"
      },
      {
        "tex": "\\hat{y}=\\arg\\max_{c\\in\\{A,B\\}}\\sum_{j\\in N_k(x)} [y_j=c]",
        "caption": "k 个最近邻多数投票"
      }
    ],
    "tips": [
      "训练集和待检测集的特征维度必须一致；首列 ID 不参与距离。",
      "k 不能大于训练样本数；平票用 tieBreak=error 可避免静默错分。",
      "CSV 支持 BOM/CRLF；A/B 标签可写成 A 类/B 类。",
      "只做本地表格计算，不上传数据。",
      "题库中的新能源车数据是训练+待检测两份，不要把待检测标签当已知。",
      "结果中的 A=180/B=156 是当前题库样本的实测统计。"
    ],
    "aka": [
      "KNN",
      "KNN分类",
      "K最近邻",
      "最近邻分类",
      "K-Nearest Neighbors",
      "knnClassify",
      "KNN 算法",
      "欧氏距离分类",
      "曼哈顿距离分类",
      "A/B 二分类",
      "新能源车分类",
      "CSV 分类"
    ]
  },
  yunying: {
    "what": "云影密码（01248）是 CTF 常见的数字替换密码：0 作为字母分隔，1/2/4/8 只表示可相加的权重，每段数字之和对应 A=1..Z=26。",
    "principle": "把密文按 0 分段，每段只允许 1/2/4/8；段内数字求和得到 1..26 的序号，再映射为 A-Z。\n\n加密反向：字母序号拆成 8/4/2/1 的组合，按权重从大到小排列，字母之间用 0 分隔。\n\n它不是二进制：数字 1/2/4/8 是可重复相加的权重，例如 8+8+8+2=26=Z。",
    "usage": "把 01248 数字串放入输入框，选择解码；把仅含 A-Z 的明文放入，选择编码。解码会严格拒绝含 0/1/2/4/8 以外字符、或段和不在 1..26 的输入。",
    "examples": [
      {
        "in": "880810421",
        "out": "PIG",
        "desc": "88=16(P), 8=8(H)? 按标准分段示例应以实际分隔为准；本工具按 0 分段，880810421 → PIG。"
      },
      {
        "in": "ALICE",
        "out": "1084081021041",
        "desc": "A=1→1, L=12→84, I=9→81, C=3→21, E=5→41；字母间 0 分隔。"
      }
    ],
    "formulas": [
      {
        "tex": "v=\\sum d_i,\\quad d_i\\in\\{1,2,4,8\\}",
        "caption": "每段数字和"
      },
      {
        "tex": "\\text{char}=A_{v-1}",
        "caption": "v∈1..26 映射到 A-Z"
      }
    ],
    "tips": [
      "0 只是分隔符，不是数值 0；连续/末尾的 0 不产生字母。",
      "段和必须 1..26；超过 26 或含其他数字应显式报错。",
      "加密只接受 A-Z；空格会被忽略。",
      "不是二进制/八进制，1/2/4/8 可重复相加。"
    ],
    "aka": [
      "云影密码",
      "01248",
      "云影",
      "01248密码",
      "Yunying",
      "Yunying cipher",
      "01248 cipher",
      "数字和密码",
      "云影加密",
      "云影解密",
      "01248编码",
      "01248解码"
    ]
  }
};
