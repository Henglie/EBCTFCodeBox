/*
 * eduContent.part-misc.js — 科普卡数据分片：隐写/图像 + 杂项（信号/时间/几何等）。
 * 纯数据，无 import、无副作用。格式契约见 eduContent.js 头注释。
 * 面向大一大二学生：通俗、准确、能跑通的例子。
 */

export default {
 // ============ 隐写 / 图像 ============
  lsbImage: {
    what: "LSB 图片隐写——misc 的招牌。把秘密信息藏进每个像素颜色值的最低位，肉眼几乎看不出画面变化。",
    principle:
      "一个像素的 R/G/B 各是 0~255 的整数。把某个通道的「最低有效位」（个位的二进制位）改成 0 或 1，颜色只变动 $\\pm 1$，人眼分辨不出，却能逐位塞进一段隐藏数据。\n\n" +
      "常见约定：前 32 位存消息长度，之后按选定通道顺序逐位取出。",
    usage: "解码：上传图片、选通道（R/G/B/A）读出隐藏信息。编码：把信息写进图片最低位生成新图。",
    examples: [
      { in: "一张 PNG", param: "通道=R", out: "隐藏的 flag{...}", desc: "从红色通道最低位逐位拼出" },
    ],
    tips: [
      "看到「图片正常但题目暗示藏东西」，先试 LSB，再试 exif、binwalk、通道分离。",
      "容量不够时把「位深」调到 2~3 位/通道，容量翻倍/三倍（改动也更明显）。",
      "PNG 无损才适合 LSB；JPEG 有损压缩会破坏最低位。",
    ],
    aka: ["lsb", "最低有效位", "像素隐写", "least significant bit", "lsb隐写", "图片lsb", "最低位隐写", "位平面隐写", "lsb steganography", "图像隐写", "bit plane", "通道隐写"],
  },

  exifExtract: {
    what: "读图片的 EXIF 元数据。相机型号、拍摄时间、甚至 GPS 坐标都藏在这，flag 常年爱躲这里。",
    principle: "JPEG 在 APP1 段里塞 EXIF（TIFF 结构），记录 Make/Model/DateTime/GPS 等标签。改图不改元数据时，秘密就留在里面。",
    usage: "上传 JPEG，解析并列出全部 EXIF 标签。重点看 GPS、备注、软件字段。",
    examples: [{ in: "一张 JPEG", out: "Make/Model/DateTime/GPS 等键值" }],
    tips: ["GPS 坐标可能直接是题目答案；UserComment/ImageDescription 常被塞 flag。"],
    aka: ["exif", "元数据", "图片属性", "metadata", "exif提取", "图片元数据", "exif数据", "gps坐标提取", "拍摄信息", "exif metadata", "jpeg元数据", "照片信息"],
  },

  zeroWidth: {
    what: "零宽字符隐写：用一批「看不见、不占宽度」的 Unicode 字符，把秘密夹在正常文本的字缝里。",
    principle:
      "零宽字符（如 `U+200B` 零宽空格、`U+200C/200D` 零宽连接符、`U+FEFF`）在屏幕上不显示。把它们按约定映射成比特（如四进制），就能在一段正常句子里藏一串隐藏消息。",
    usage: "把可疑文本（复制粘贴一段看似普通的话）粘进来解码，取出零宽字符携带的隐藏信息；也可编码藏字。",
    examples: [
      { in: "一段普通文字（内含零宽字符）", out: "隐藏消息", desc: "肉眼看不出，解码才现形" },
    ],
    tips: [
      "复制来的文本长度和肉眼字数对不上、或末尾选中有「空白」，怀疑零宽。",
      "先用隐写类 `zwScan` 扫一遍位置和数量，再决定怎么解。",
    ],
    aka: ["zero width", "零宽字符", "零宽隐写", "不可见字符", "零宽字符隐写", "zero width steganography", "zwsp", "零宽空格", "不可见字符隐写", "零宽连接符", "文本隐写", "unicode隐写"],
  },

  pngHeight: {
    what: "改 PNG 高度：CTF 经典手法。把图片高度字段改小，藏在下半部分的内容就被裁掉不显示了——改回去就露馅。",
    principle:
      "PNG 的 IHDR 块存着宽和高。把高度值改小，图片查看器只画上半截；但文件里的像素数据还在。改大高度即可让隐藏区域重新显示。\n\n" +
      "注意 IHDR 后有 CRC 校验，工具会一并帮你修正。",
    usage: "上传 PNG，读取/修改 IHDR 高度（base64 进出，直接操作文件字节，不经画布）。",
    examples: [{ in: "一张 PNG", param: "改高度", out: "高度被修正的新 PNG，露出下半部分" }],
    tips: [
      "打开图片报「CRC error / 高度异常」，几乎必是这题——把高度调大。",
      "有的题改宽度或故意破坏 CRC，思路一样：修 IHDR。",
    ],
    aka: ["png高度", "png宽高", "ihdr", "改高度", "png高度修改", "png宽高修改", "ihdr高度", "png height", "修改png尺寸", "png隐写", "图片高度修改", "png crc"],
  },

  braille: {
    what: "盲文点字：用 6 或 8 个凸点的组合表示字符，对应 Unicode 的 `⠿` 一类点阵方块。",
    principle: "每个盲文符号是 `U+2800` 起始区块里的一个点阵（2 列 × 3~4 行的点开/关组合），映射到 ASCII 字符。",
    usage: "粘盲文方块（⠓⠑⠇⠇⠕）解码成 ASCII；编码方向反向。",
    examples: [{ in: "⠓⠑⠇⠇⠕", out: "hello" }],
    tips: ["看到一串小圆点方块 ⠿⠷⠮ 就是盲文，直接丢进来解。"],
    aka: ["盲文", "点字", "braille", "点阵"],
  },

 // ============ 隐写检测类 ============
  zwScan: {
    what: "零宽字符扫描器：把文本里所有看不见的 Unicode 格式字符揪出来，标位置、给统计、能一键剥离。",
    principle: "遍历文本，命中零宽/连接符/标记等不可见码位就记录索引，高亮列出并统计各类型数量。",
    usage: "粘可疑文本，输出不可见字符清单 + 位置 + 剥离后的干净文本。",
    examples: [{ in: "内含零宽的文本", out: "命中位置 + 类型统计" }],
    aka: ["零宽扫描", "zero width scan", "不可见字符扫描", "零宽字符扫描", "零宽检测", "不可见字符检测", "zw scan", "零宽字符探测", "隐藏字符扫描", "零宽剥离", "unicode格式字符扫描", "零宽清理"],
  },

 // ============ 花式信号（放这片，避免与 classic 分片重叠） ============
  semaphore: {
    what: "旗语：用两面旗子的不同角度组合表示字母，航海题/图片题偶尔出现。",
    principle: "每个字母对应两只手臂（旗）的一组方向（8 个方向），基于 Wikipedia 的 Flag semaphore 标准表。",
    usage: "按工具约定的方向记号输入，解码成字母；编码方向反向。",
    examples: [{ in: "方向对序列", out: "字母" }],
    aka: ["旗语", "semaphore", "flag semaphore"],
  },

  dna: {
    what: "DNA 编码：用 A/C/G/T 四种碱基的三字母「密码子」表示字符，misc 里常见的趣味套路。",
    principle: "3 个碱基一组（$4^3=64$ 种组合）映射到字符表，很像生物课的密码子表。",
    usage: "粘 ACGT 串解码；编码方向把文本转成碱基串。",
    examples: [{ in: "ATGGCT…", out: "明文", desc: "每 3 个碱基一个字符" }],
    tips: ["只有 A/C/G/T 四个字母、长度是 3 的倍数，考虑 DNA 编码。"],
    aka: ["dna编码", "碱基编码", "acgt"],
  },

 // ============ 进制/网络类补充 ============
  ipv4Int: {
    what: "IPv4 点分十进制 ↔ 32 位整数互转。取证/网络题里把 IP 藏成一个大整数是常见花招。",
    principle:
      "`a.b.c.d` 每段 8 位，拼成 32 位整数：$a \\cdot 256^3 + b \\cdot 256^2 + c \\cdot 256 + d$。还支持 0x 十六进制、八进制等 `inet_aton` 变体写法。",
    usage: "输入点分 IP 得整数，或输入整数得回 IP。",
    examples: [
      { in: "192.168.1.1", out: "3232235777" },
      { in: "3232235777", param: "解码方向", out: "192.168.1.1" },
    ],
    formulas: [{ tex: "N = a\\cdot 256^3 + b\\cdot 256^2 + c\\cdot 256 + d", caption: "IPv4 → 整数" }],
    tips: ["看到一个 32 位内的可疑大整数（如 3232235777），试试当 IP 解。"],
    aka: ["ip转整数", "ipv4 int", "inet_aton"],
  },

  geoHash: {
    what: "Geohash：把经纬度编码成一串短字符，字符串越长定位越精确。地理坐标题高频。",
    principle: "对纬度、经度交替做二分（在还是不在上半区 → 一个比特），比特流按 5 位一组查 base32 表（去掉 a/i/l/o）。前缀相同 = 地理位置相近。",
    usage: "输入 geohash 串解码出经纬度；编码方向把经纬度转 geohash。",
    examples: [{ in: "u4pruydqqvj", out: "≈ (57.649, 10.407)" }],
    tips: ["一串没有 a/i/l/o 的小写字母数字、又和地图/坐标相关，多半是 geohash。"],
    aka: ["geohash", "地理哈希", "geo hash"],
  },
};
