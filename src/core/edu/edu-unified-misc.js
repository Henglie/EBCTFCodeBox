/*
 * edu-unified-misc.js — 归一/杂项科普补缺分片（T317）。
 *
 * 覆盖 5 个真实缺失 op 的科普卡：
 * analysis: archiveUnified, cryptoAddrUnified, imageStructUnified
 * cn: numToPinyin, hanziToPinyin
 *
 * 核查删除（已覆盖，不重复建）：
 * - musicNotation / musicInfo — 已在 edu-fancy-rest.js（已 import）覆盖
 * - geoUtm — 已在 edu-radix-geo.js（已 import）覆盖
 *
 * 纯数据无副作用，无 import 无 register。M 在 eduContent.js 归并。
 * EduEntry 格式照 eduContent.js 头注释契约。
 */
export default {
 // ============ analysis: 归一入口 ============
  archiveUnified: {
    what: "压缩/归档文件归一分析——拖入一坨二进制，自动认出是 gzip/zip/7z/tar 还是别的，列结构、能解就解。",
    principle:
      "靠文件头 magic bytes 分派：`1f 8b` 是 gzip、`78 9c/78 da` 是 zlib、`42 5a 68` 是 bzip2、`50 4b 03 04` 是 ZIP、`52 61 72 21` 是 RAR、`37 7a bc af 27 1c` 是 7z、tar 看 257 偏移的 `ustar`。\n\n" +
      "认出格式后分四档处理：gzip/zlib/deflate 走纯 JS 流式解压给预览；ZIP 解析中央目录 + 伪加密检测（把压缩方式位改回 0 的经典坑）；7z 走 wasm 列表/解压（从本地 public/wasm/ 懒加载，缺了优雅降级）；bzip2/rar 仅识别提示（纯 JS 解不动）。输入支持 hex/base64/UTF-8 自动识别。",
    usage: "把压缩文件的 hex 或 base64 粘进输入框（或拖文件），点运行输出格式识别 + 结构清单 + 解压预览。7z 加密档案在「7z 密码」参数框填密码，7z 操作选「列表」或「解压」。",
    examples: [
      { in: "(gzip 文件的 base64，如 H4sIAAAAAAAAA0...)", out: "格式: gzip (magic 1f 8b)\n原始数据: Hello World", desc: "gzip 自动识别 + 解压预览" },
      { in: "(ZIP 文件的 base64，含伪加密)", out: "格式: ZIP\n伪加密检测: 是（压缩方式位被改）\n文件清单: flag.txt", desc: "ZIP 伪加密自动检测" },
    ],
    tips: [
      "CTF misc 第一道工序：拿到一坨二进制先扔进来认格式，比肉眼数 magic 快。",
      "ZIP 伪加密是经典坑——中央目录的压缩方式位被改成 9（加密）但数据没真加密，本工具自动检测并标出。",
      "7z 解压走 wasm，首次加载稍慢；wasm 不可用时降级为仅列结构不报错。",
      "bzip2/rar 只能认格式不能解（纯 JS 无实现），需换外部工具。",
    ],
    aka: ["压缩归档分析", "archive unified", "归档归一", "magic识别", "压缩文件分析", "归档格式识别", "archive analysis", "压缩包分析", "文件头识别", "gzip zip 7z识别", "压缩流分析", "归档统一分析"],
  },

  cryptoAddrUnified: {
    what: "加密货币地址解析——丢一个 BTC 或 ETH 地址进来，自动认出是什么类型、校验和对不对、哪个网络。",
    principle:
      "BTC 地址按前缀分三类：`1` 开头是 P2PKH（Legacy，Base58Check）、`3` 开头是 P2SH（Legacy，Base58Check）、`bc1q` 开头是 P2WPKH/P2WSH（SegWit，Bech32）、`bc1p` 开头是 P2TR（Taproot，Bech32m）。\n\n" +
      "ETH 地址是 0x + 40 位 hex，靠 EIP-55 混合大小写做校验——把地址哈希一遍，按哈希位决定每个 hex 字母大小写，改一个字符校验就挂。\n\n" +
      "Base58Check 自带 4 字节校验尾（双 SHA256 前 4 字节）；Bech32 用 BCH 码校验（const=1），Bech32m 是 BIP350 给 Taproot 的变体（const=0x2bc830a3）。本工具只解析校验，绝不生成私钥。",
    usage: "输入一个 BTC 或 ETH 地址，点运行输出地址类型、网络（mainnet/testnet）、编码方式、校验和是否通过。无需参数。",
    examples: [
      { in: "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa", out: "类型: BTC P2PKH (Legacy)\n网络: mainnet\n编码: Base58Check\n校验和: 通过", desc: "创世区块地址，P2PKH" },
      { in: "0x52908400098527886E0F7030069857D2E4169EE7", out: "类型: ETH\n编码: EIP-55 混合大小写\n校验和: 通过", desc: "EIP-55 合法 ETH 地址" },
    ],
    tips: [
      "CTF 里看到 `1` / `3` / `bc1` 开头的串 + 长度 34 左右，先扔进来验是不是 BTC 地址。",
      "ETH 地址校验靠大小写，全小写/全大写的 ETH 地址无法做 EIP-55 验证（但仍是合法地址）。",
      "Bech32 和 Bech32m 容易混：witver=0 用 Bech32，witver≥1（Taproot）用 Bech32m，选错校验会挂。",
      "本工具只解析不生成私钥，安全无风险。",
    ],
    aka: ["crypto address", "加密货币地址", "btc地址", "eth地址", "区块链地址", "比特币地址", "以太坊地址", "钱包地址", "bitcoin address", "ethereum address", "地址校验", "Base58Check Bech32"],
  },

  imageStructUnified: {
    what: "图像结构归一分析——拖一张图进来，自动认出 PNG/JPG/GIF/BMP，一次性输出文件头、尺寸、块结构、EXIF、尾部藏没藏数据。",
    principle:
      "靠 magic bytes 分派：`89 50 4e 47` 是 PNG、`ff d8 ff` 是 JPEG、`47 49 46 38` 是 GIF、`42 4d` 是 BMP。\n\n" +
      "PNG 逐块解析 chunk（长度+类型+数据+CRC），重点看 IHDR 的宽高、文本块（tEXt/iTXt）、IEND 之后有没有附加数据、IHDR 的 CRC 有没有被篡改（宽高爆破题的信号）。JPEG 解析 SOF marker 拿尺寸 + EXIF/XMP 元数据。GIF 读逻辑屏幕描述符 + 帧列表。BMP 解析 BITMAPFILEHEADER + BITMAPINFOHEADER。各格式尾部附加数据（IEND/EOI/trailer 之后）单独标出——那是隐写最爱藏的地方。",
    usage: "把图像的 base64（或 data URI）粘进输入框（或直接拖文件），点运行输出统一报告：格式、尺寸、块/chunk 清单、EXIF/XMP、尾部附加数据、宽高异常修复建议。",
    examples: [
      { in: "(PNG 文件的 base64)", out: "格式: PNG\n尺寸: 100×50\n块: IHDR / IDAT / IEND\n尾部附加数据: 无\n宽高异常: 否", desc: "PNG 结构全息报告" },
      { in: "(被改宽高的 PNG，IHDR CRC 不匹配)", out: "格式: PNG\n尺寸: 10×10\n⚠ IHDR CRC 校验失败，宽高可能被篡改\n建议爆破真实宽高", desc: "宽高篡改自动检测" },
    ],
    tips: [
      "CTF 图像题第一步：扔进来认格式 + 看尾部有没有附加数据，比肉眼快。",
      "IHDR 的 CRC 不匹配 = 宽高被改了，用宽高爆破工具（pngSizeRecover）恢复真实尺寸。",
      "尾部附加数据（IEND/EOI 之后）是隐写高频区，直接提取看是不是 zip/flag。",
      "归并了 pngChunks/imgMeta/pngSizeRecover/jpegSizeRead/gifSizeRead 五个 op，一个入口看全部。",
    ],
    aka: ["图像结构分析", "image structure", "图片结构", "图像归一", "图片结构分析", "PNG结构分析", "图像取证", "image forensics", "图片元数据", "宽高爆破", "图像chunk分析", "图片隐写检测"],
  },

 // ============ cn: 拼音 ============
  numToPinyin: {
    what: "数字转拼音——把阿拉伯数字读成汉语拼音，支持逐位读和数值读两种模式。",
    principle:
      "逐位读（perDigit）：每个数字查硬编码表 `0→líng, 1→yī, 2→èr, … 9→jiǔ`，小数点读 `diǎn`，负号读 `fù`。电话/门牌场景可把 1 读成 `yāo`（参数 yao）。\n\n" +
      "数值读（value）：先把整数转成中文数字写法（如 `123` → `一百二十三`），再逐字查拼音表。支持到「兆」级（$10^{16}$），算法是标准中文数字组合：每 4 位一组，组内用「千百年十」位，组间用「万亿兆」单位，十几省首「一」，连续零压缩。\n\n" +
      "声调形式三种：带调符号（`yī`，默认）、数字调（`yi1`）、无调（`yi`）。数字调模式把 `ü` 写成 `v`（CTF/输入法惯例）。",
    usage: "选读法（逐位/数值，默认逐位）、1 是否读 yāo（默认否）、声调形式（带调符号/数字调/无调，默认带调）。输入数字串，输出拼音。",
    examples: [
      { in: "123", param: "mode=perDigit, tone=mark", out: "yī èr sān", desc: "逐位读：1 2 3" },
      { in: "123", param: "mode=value, tone=mark", out: "yī bǎi èr shí sān", desc: "数值读：一百二十三" },
      { in: "119", param: "mode=perDigit, yao=true, tone=mark", out: "yāo yāo jiǔ", desc: "火警电话，1 读 yāo" },
    ],
    tips: [
      "逐位读适合电话号/身份证号，数值读适合金额/数量。",
      "数值读仅支持单个整数或小数（如 1234 / 3.14 / -8），不支持表达式。",
      "数字调模式 `yi1` 这种写法和输入法一致，CTF 里偶尔用作编码。",
    ],
    aka: ["数字转拼音", "number to pinyin", "数字拼音", "拼音数字", "阿拉伯数字读法", "数字读拼音", "数字念法", "num to pinyin", "数字转中文拼音", "数字发音", "digit pinyin", "数字转读音"],
  },

  hanziToPinyin: {
    what: "汉字转拼音——把中文汉字转成汉语拼音，内置约 300 个高频常用字，多音字取最常见读音。",
    principle:
      "查内置 `PINYIN_MAP`（约 300 字，覆盖《现代汉语常用字表》高频字），逐字查表输出拼音。多音字默认取最常见读音（如 `长→cháng`、`了→le`），不保证语境正确。\n\n" +
      "表外字（不在 300 字表里的生僻字）按参数处理：原样保留（`keep`，默认）或标记为 `?`（`mark`）。空白字符跳过。\n\n" +
      "声调形式三种：带调符号（`nǐ`，默认）、数字调（`ni3`）、无调（`ni`）。数字调模式把 `ü` 写成 `v`。",
    usage: "选声调形式（带调符号/数字调/无调，默认带调）、表外字处理（原样保留/标?，默认原样）。输入汉字串，输出拼音（空格分隔）。",
    examples: [
      { in: "你好", param: "tone=mark", out: "nǐ hǎo", desc: "基本转换" },
      { in: "中国", param: "tone=number", out: "zhong1 guo2", desc: "数字调形式" },
    ],
    tips: [
      "仅覆盖约 300 高频字，生僻字会原样保留或标 ?，不是全能字典。",
      "多音字取最常见读音，语境不匹配时需人工校正。",
      "CTF 里偶尔用拼音首字母或数字调做编码，本工具可快速转全文拼音。",
    ],
    aka: ["汉字转拼音", "hanzi to pinyin", "中文转拼音", "拼音转换", "汉字拼音", "中文拼音标注", "拼音注音", "chinese to pinyin", "汉字注音", "pinyin converter", "汉字读音", "中文转读音"],
  },
};
