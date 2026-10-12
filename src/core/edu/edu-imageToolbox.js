// 科普内容分片：图像处理工具批（imageCompress/imageGray/imagePixelate/imageFrosted/
// imageSketch/imageToText/gifCompose/img2dataURI 共 8 op）。纯数据，无 import 无副作用。
export default {
  imageCompress: {
    what: "图片压缩：把一张图按质量档重新编码，让文件变小。可以顺便统一格式（JPEG/PNG/WebP）和缩小尺寸。",
    principle:
      "JPEG/WebP 是有损压缩：把图切成 8×8 块做 DCT（离散余弦变换），人眼不敏感的高频分量直接丢掉——质量档越低丢得越狠，文件越小但越「糊」、块状伪影越明显。PNG 是无损压缩：一个字节都不丢，靠的是行内预测 + zlib，所以「质量档」对 PNG 无效。\n\n" +
      "目标最大宽用最近邻缩小：每个新像素取源图对应位置的一个像素，公式 $src=\\lfloor (dst+0.5)\\cdot W_{src}/W_{dst}\\rfloor$（与 Pillow NEAREST 同中心约定）。",
    usage: "拖入图片（或粘 base64/dataURL），选质量档（0-100）与输出格式，可选填目标最大宽。输出预览 + 下载。要小体积选 JPEG/WebP + 中低质量；要保像素选 PNG。",
    examples: [
      { in: "（一张 2MB 的截图 PNG）", param: "quality=70, format=jpeg", out: "几百 KB 的 JPEG，肉眼几乎无损", desc: "截图/照片压缩比常达 5-20 倍" },
    ],
    tips: [
      "质量档只对 JPEG/WebP 生效；PNG 选任何质量输出都不变。",
      "有损压缩不可逆：存原件永远比存压缩件好，CTF 里对载体图反复压缩会破坏隐写载荷。",
      "目标最大宽只在图片实际更宽时才缩，不会放大小图。",
    ],
    aka: ["图片压缩", "image compress", "压缩图片", "图片变小", "质量压缩", "jpeg压缩", "jpg压缩",
      "图片重编码", "recompress", "图片转jpeg", "图片转jpg", "图片瘦身", "图片缩放", "减小体积", "webp"],
  },

  imageGray: {
    what: "图片黑白化：把彩色图变成灰度图（256 级明暗）或干脆二值化（纯黑纯白）。",
    principle:
      "灰度不是 (R+G+B)/3！人眼对绿色最敏感、蓝色最不敏感，标准公式按感知加权：$L=0.299R+0.587G+0.114B$（ITU-R BT.601）。本工具用 $\\lfloor(299R+587G+114B)/1000\\rfloor$ 的整除实现，与 Pillow `convert('L')` 逐像素一致。\n\n" +
      "二值化 = 灰度再过一遍阈值：≥阈值判白、<阈值判黑。阈值选得好，文字/图案从背景里跳出来。",
    usage: "拖入图片，选 gray（灰度）或 binary（二值+阈值 0-255）。输出 PNG 预览 + 下载。",
    examples: [
      { in: "（一张彩色二维码截图）", param: "mode=gray", out: "灰度图，亮度分布不变", desc: "与 Pillow convert('L') 逐像素一致" },
      { in: "（被涂鸦干扰的文字图）", param: "mode=binary, threshold=128", out: "纯黑纯白，干扰色被压平", desc: "阈值可调 0-255" },
    ],
    tips: [
      "扫描件/截图里的暗水印、铅笔痕，二值化后常更清晰。",
      "位平面隐写的第一步通常就是灰度化——先把颜色信息丢掉才看得见亮度纹理。",
      "二值化阈值拖到极端（0 或 255）会得到全白/全黑图，属正常现象不是 bug。",
    ],
    aka: ["黑白化", "图片黑白", "灰度化", "grayscale", "灰度转换", "转灰度", "二值化", "binarize",
      "图片去色", "黑白照片", "gray", "灰度图", "图片变黑白", "otsu", "阈值化"],
  },

  imagePixelate: {
    what: "图片像素化（马赛克）：把图切成方块，每块取平均色填充——细节没了，只剩色块。",
    principle:
      "输出图每个像素对应源图一个 block×block 方块：块内所有像素取算术平均。右/下边缘不满一块时按实际覆盖面积收缩平均（不补边）。属于 box filter 的降采样形态，与 Pillow 的 `reduce` 同族（整数舍入差 ±1 以内）。",
    usage: "拖入图片，填方块尺寸（1-512，默认 8）。输出预览 + 下载。",
    examples: [
      { in: "（一张 200×150 图）", param: "block=10", out: "20×15 的色块图", desc: "边缘不满块按实际面积平均" },
    ],
    tips: [
      "CTF 里遇到「打码的flag」，马赛克是不可逆的——但块小时可以试逐块暴力还原字形。",
      "反向用法：把 flag 文字图马赛克化后每格当像素点读，适合做「点阵字」。",
      "block=1 等于原图（每块就是单像素）。",
    ],
    aka: ["像素化", "马赛克", "mosaic", "pixelate", "打码", "图片模糊块", "色块化", "像素块",
      "图片马赛克", "打马赛克", "block average", "块平均", "降采样", "pixelize"],
  },

  imageFrosted: {
    what: "图片毛玻璃：整张图像被均匀揉糊，像隔着磨砂玻璃看——低频留下、高频抹掉。",
    principle:
      "盒模糊（box blur）：每个像素取周围 (2r+1)×(2r+1) 方窗的平均值。实现上拆成「先横向滑窗平均、再纵向滑窗平均」两遍（可分离卷积），复杂度与半径无关。边缘窗口按实际存在的像素收缩平均。两遍盒模糊叠加近似高斯模糊。",
    usage: "拖入图片，填模糊半径（1-20，默认 4）。输出预览 + 下载。",
    examples: [
      { in: "（一张细纹理截图）", param: "radius=8", out: "细节被抹平的大色块图", desc: "半径越大越糊" },
    ],
    tips: [
      "半径 1-2 只轻微柔化；10 以上基本看不清小字。",
      "与像素化的区别：毛玻璃是连续过渡的糊，马赛克是离散色块。",
      "频域视角：盒模糊是低通滤波——想找藏在高频里的图案，先把低频糊掉再看差值。",
    ],
    aka: ["毛玻璃", "frosted glass", "盒模糊", "box blur", "模糊", "高斯模糊近似", "图片模糊",
      "blur", "磨砂", "柔化", "图片变糊", "低通滤波", "平滑", "smoothing"],
  },

  imageSketch: {
    what: "图片转素描：把照片变成铅笔画——白纸黑线两档：颜色减淡素描（dodge）与 Sobel 边缘。",
    principle:
      "dodge 档（经典铅笔素描算法）：① 取灰度 $g$；② 反相 $255-g$ 并盒模糊得 $b$；③ 颜色减淡混合 $out=g\\times 255/(255-b)$（分母为 0 记 255）。模糊半径控制线条粗细。\n\n" +
      "edge 档：Sobel 算子——两个 3×3 卷积核分别对横向/纵向求梯度 $G_x,G_y$，幅值 $\\sqrt{G_x^2+G_y^2}$ 越大越黑，输出白底黑线轮廓。",
    usage: "拖入图片，选 dodge（素描感强）或 edge（轮廓线），dodge 可调模糊半径 1-40。输出预览 + 下载。",
    examples: [
      { in: "（一张人像照片）", param: "mode=dodge, blurRadius=12", out: "白纸黑线的铅笔画" },
      { in: "（一张徽标图）", param: "mode=edge", out: "只有轮廓线的黑白图" },
    ],
    tips: [
      "dodge 的输出几乎全白、只有笔画深——适合观察「藏在明暗里的图案」。",
      "edge 档对照片输出很乱、对图标/文字/几何图案效果最好。",
      "被半透明色块盖住的字，edge 化后常直接显形。",
    ],
    aka: ["转素描", "素描化", "铅笔素描", "pencil sketch", "sketch", "颜色减淡", "color dodge",
      "sobel边缘", "边缘检测", "edge detection", "轮廓提取", "图片素描", "铅笔画", "线稿"],
  },

  imageToText: {
    what: "图片文字化（字符画 / ASCII art）：把图变成一串字符——亮的地方用浅字符（如 . 空格），暗的地方用密字符（如 @ #）。",
    principle:
      "① 按输出列数把图切成网格（纵向步长取横向 2 倍，补偿等宽字体「字高≈字宽 2 倍」的比例，否则人像会被拉扁）；② 每格取平均亮度 $L=0.299R+0.587G+0.114B$；③ $idx=\\lfloor L/256\\times n\\rfloor$ 查字符梯度表。反色交换明暗映射，适配亮底深图。",
    usage: "拖入图片，调输出列数（20-400，默认 80）、字符梯度表与反色。输出纯文本，可直接复制粘贴。",
    examples: [
      { in: "（一张 flag 文字图）", param: "width=100", out: "用 @#* 排出的字符画，远看就是 flag" },
      { in: "（黑底亮字图）", param: "invert=true", out: "反色后字符画正确显示字形" },
    ],
    tips: [
      "等宽字体里粘贴才不变形；列数越大越精细、行数也越多。",
      "bits 梯度表（01）输出即位流——把小图转成 0/1 串做后续位运算很顺手。",
      "反过来看：字符画解题时，把字符按密度还原成像素图是常见出题/解题套路。",
    ],
    aka: ["字符画", "ascii art", "图片转文字", "文字化", "字符画生成", "asciiart", "图片字符化",
      "text art", "字符图", "图片转ascii", "ascii画", "字符梯度", "亮度映射", "图片文本化"],
  },

  gifCompose: {
    what: "GIF 合成：把多张图片按顺序拼成一个动图 GIF，可设每帧延时和循环次数。「GIF 多帧提取」的反向操作，出题/回炉闭环。",
    principle:
      "自实现 GIF89a 编码器：① 全局色表——唯一色 ≤256 直接精确建表，否则中位切分法（median cut）按像素数加权反复切分色域到 256 色，像素映射走 RGB555 网格最近色；② 每帧一个 Graphic Control Extension 写入延时（厘秒 = 毫秒/10）；③ 像素索引流经 LZW 压缩（GIF 口径变长码、LSB 优先装包、4096 码满发 CLEAR 重置）；④ 头部带 NETSCAPE2.0 应用扩展实现循环（0=无限）。非首帧尺寸的图先等尺寸化到首帧（拉伸或等比居中铺填充色）。",
    usage: "拖入一张图 + 其余图片按行粘 base64/dataURL 到主输入或「追加图片」参数（≥2 张），设每帧延时（毫秒）与循环次数。输出 GIF 预览 + 下载，可用「GIF 多帧提取」反向验证。",
    examples: [
      { in: "（按行粘 3 张同尺寸 PNG）", param: "delay=200, loop=0", out: "3 帧循环播放的 GIF" },
      { in: "（大小不一的图）", param: "fitMode=pad, padColor=#ffffff", out: "居中铺白底的等尺寸动图" },
    ],
    tips: [
      "延时是厘秒粒度（1/100 秒）：100ms 与 109ms 都落成 10 厘秒；浏览器对 <20ms 的延时普遍按 100ms 渲染。",
      "和「GIF 帧时序隐写」联动：帧延时序列本身可以藏信息——出题时故意用非常规延时。",
      "照片类素材颜色超 256 色会量化降质；线条图/二维码类通常颜色极少，无损合成。",
    ],
    aka: ["gif合成", "gif compose", "合成gif", "图片转gif", "做gif", "动图合成", "gif制作",
      "拼gif", "生成gif", "多图合成", "帧动画", "gif encoder", "lzw", "动图制作", "图片合成gif"],
  },

  img2dataURI: {
    what: "图片转 Base64/dataURI：把图片文件直接变成一串文本——贴进 HTML/CSS/JS 里当「内嵌图片」用，不需要单独的图片文件。",
    principle:
      "data URI 的格式是 `data:[<MIME>][;base64],<数据>`：MIME 声明类型，base64 标记说明数据段是 base64 编码。本工具按文件头魔数嗅探 MIME（PNG 的 89 50 4E 47、JPEG 的 FF D8 FF、GIF 的 GIF8、BMP 的 BM、WebP 的 RIFF…WEBP、ICO 的 00 00 01 00），不信任扩展名——CTF 载体常故意改后缀。",
    usage: "拖入图片（或粘 base64/dataURL），选输出形式：dataURI（可直接嵌网页）/ base64 裸串 / 两者都要。输出纯文本。",
    examples: [
      { in: "（拖入一张 PNG）", param: "output=datauri", out: "data:image/png;base64,iVBORw0KGgo..." },
      { in: "（一张改名 .txt 的 JPEG）", param: "output=both", out: "MIME 仍识别为 image/jpeg——按文件头不按扩展名" },
    ],
    tips: [
      "CSS 里用法：background-image: url(data:image/png;base64,...)。",
      "看到一段 data:image/ 开头的长串，粘进本工具反向粘贴即可还原成图片文件。",
      "base64 让体积膨胀约 4/3 倍；大图内嵌不如用文件引用。",
    ],
    aka: ["图片转base64", "img2base64", "图片转datauri", "data uri", "图片base64", "图片编码",
      "图片转base", "base64图片", "内嵌图片", "图片嵌入", "image to base64", "datauri生成",
      "图片转码", "mimesniff", "图片转文本"],
  },

  spriteSheet: {
    what: "精灵图（Sprite Sheet）与序列帧互转：把网格排列的精灵图按等分切成一帧帧独立图片，或把一组等尺寸序列帧拼回一张网格精灵图。",
    principle:
      "精灵图是游戏引擎的标准素材形态：所有帧等尺寸，按行主序（先第 1 行从左到右，再第 2 行…）排成 $cols\\times rows$ 网格。切帧是纯几何运算：帧宽 $fw=W/cols$、帧高 $fh=H/rows$，第 $(r,c)$ 帧取源图矩形 $(c\\cdot fw, r\\cdot fh)$——逐像素复制、零重采样，无损往返（拆了再拼与原图逐字节一致）。图宽/图高必须能被列数/行数整除，否则显式报错而不是静默裁边。",
    usage: "拆帧：拖入精灵图，填列数与行数（网格几列几行），输出 frame_000 起的逐帧 PNG 下载。合成：方向切「序列帧 → 精灵图」，拖入首帧，其余帧以 base64/dataURL 每行一条填进追加框，填每行列数（末行空位补透明）。",
    examples: [
      { in: "（一张 512×512 的 4×4 精灵图）", param: "mode=split, cols=4, rows=4", out: "16 张 128×128 的 frame_000…frame_015.png", desc: "行主序编号，可再交「GIF 合成」做成动图" },
      { in: "（8 张 64×64 序列帧）", param: "mode=merge, cols=4", out: "256×128 的 4×2 精灵图", desc: "末行空位补透明" },
    ],
    tips: [
      "行主序是主流约定（Unity/Godot/Cocos 导出的 sprite sheet 都按行排）——拆出来编号错乱时先确认是不是列主序导出。",
      "等尺寸是硬约束：帧大小不一的序列先用图片缩放统一尺寸再合成。",
      "CTF 里精灵图常把 flag 拆散到某一帧：先拆帧逐帧看，比肉眼看大图快得多。",
    ],
    aka: ["精灵图", "sprite sheet", "sprite", "spritesheet", "序列帧", "拆帧", "切帧", "帧提取",
      "雪碧图", "图集切割", "逐帧拆分", "序列帧合成", "精灵图切割", "帧序列", "帧拆分"],
  },
};
