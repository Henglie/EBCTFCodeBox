// 科普内容分片：stego QR/条码 + 音频类。纯数据，无 import 无副作用。
export default {
  qrGen: {
    what: "QR 码生成：把文本编成一张 QR 二维码的 0/1 矩阵。核心是纯 JS 实现，输出矩阵 JSON 方便你看结构或再解码。",
    principle:
      "QR 把数据先按模式（数字/字母数字/字节）编码成比特流，加上纠错级别（L/M/Q/H）对应的 Reed-Solomon 纠错码，再按之字形填进矩阵，最后叠一层掩码让黑白分布更均匀。三个角的大方块是 finder 定位图案。",
    usage: "输入文本、选模式和纠错级，输出 0/1 矩阵 JSON（1=黑模块，0=白）。可再喂给 qrDecode 验证。",
    examples: [
      { in: "HELLO", param: "纠错级=M", out: "0/1 矩阵 JSON", desc: "1 是黑格，0 是白格" },
    ],
    tips: ["纠错级越高（H）能容忍越多破损，但矩阵越大。CTF 里给残缺 QR 常靠高纠错级救回。"],
    aka: ["qr生成", "qr code", "二维码生成", "qr encode", "二维码编码", "qr码生成", "quick response code", "qrcode生成", "生成二维码", "qr矩阵生成", "reed-solomon二维码"],
  },

  qrParse: {
    what: "QR 结构解析：不解码内容，先看这张 QR 的「体检报告」——版本几、用了哪个掩码、纠错级多少、定位图案对不对。",
    principle:
      "QR 矩阵里有固定含义的区域：三个角的 finder 定位图案、时序线、格式信息（存纠错级+掩码号）、版本信息（版本≥7）。读这些结构位就能判断矩阵是否规整、参数是多少，不必真的解出数据。",
    usage: "粘 QR 矩阵（ASCII art 或 0/1 行），输出版本、掩码、纠错级和 finder/暗模块校验结果。",
    examples: [
      { in: "0/1 矩阵或 ASCII art", out: "版本=2, 掩码=3, 纠错级=M, finder 正常" },
    ],
    tips: ["解不出内容先用它体检：finder 缺角、暗模块不对，说明矩阵抄错或被裁，先修结构再 qrDecode。"],
    aka: ["qr解析", "qr结构", "qr parse", "二维码结构", "qr结构分析", "qr code structure", "二维码解析", "qr version掩码", "qr体检", "qr format info", "qr矩阵解析"],
  },

  barcodeIdentify: {
    what: "条码类型判定：给一段条码数据，判断它是 2D 码（QR/Aztec/DataMatrix）还是 1D 商品码（EAN/UPC/ISBN/Code39 等），并顺手验校验位。",
    principle:
      "2D 码按矩阵结构特征（finder 图案形态）区分；1D 码按位数和校验规则区分——EAN-13/UPC-A 有模 10 校验位、ISBN 有模 11/模 10 校验、Code39/Codabar 有固定起止符。工具综合长度、字符集、校验判定类型。",
    usage: "粘条码数据（矩阵或数字串），输出最可能的条码类型 + 校验结果。",
    examples: [
      { in: "6901234567892", out: "EAN-13, 校验位通过" },
      { in: "0/1 大矩阵", out: "疑似 QR（有三个 finder）" },
    ],
    tips: ["拿不准是哪种码先用它分诊，再选 qrDecode 或对应 1D 校验工具。"],
    aka: ["条码识别", "barcode identify", "条形码类型", "条码类型判定", "barcode type", "一维码识别", "ean upc识别", "条码分诊", "barcode detect", "条形码识别", "1d 2d码判定"],
  },

  qrDecode: {
    what: "QR 码解码：从 0/1 矩阵反解出 QR 里藏的原文。走完 finder 检测→读格式信息→之字形取数→去掩码→RS 纠错→按模式还原的全流程。",
    principle:
      "解码是编码的逆过程：先用 finder 定位图案确定方向和网格，读格式信息拿到掩码号和纠错级，按之字形从右下往上取比特，异或掉掩码，再用 Reed-Solomon 纠错修复错误比特，最后按分段模式（数字/字母数字/字节）还原成文本。",
    usage: "粘 QR 的 0/1 矩阵，工具反解出原文。矩阵有小破损也能靠 RS 纠错救回。",
    examples: [
      { in: "完整 0/1 矩阵", out: "flag{...}", desc: "含纠错，容忍部分错格" },
    ],
    tips: ["矩阵方向/黑白反转会导致解不出，先用 qrParse 体检。纠错能修有限个错块，破损太多仍会失败。"],
    aka: ["qr解码", "qr decode", "二维码解码", "扫码", "qr码解码", "qr code decode", "二维码识别", "qr矩阵解码", "reed-solomon纠错解码", "scan qr", "qr reader", "二维码还原"],
  },

  qrDecodeReport: {
    what: "QR 解码诊断：qrDecode 的「带解说版」，把版本、纠错级、掩码、finder、RS 纠错修了几个块、分了几段、每段什么模式全列出来，解不出时用来定位卡在哪。",
    principle:
      "在完整解码流程的每一步都打印中间状态：识别到的版本/ECL/掩码、finder 检测结果、RS 纠错纠正的错误符号数、数据分段的模式与内容。哪一步异常一目了然。",
    usage: "粘 QR 矩阵（qrGen 的 JSON 或 ASCII art），输出逐步诊断报告 + 最终原文。",
    examples: [
      { in: "QR 矩阵", out: "版本2/ECL=M/掩码3/RS纠错2块/字节模式/原文" },
    ],
    tips: ["普通 qrDecode 失败时改用它，看是 finder 没认出、掩码错还是纠错超限。"],
    aka: ["qr诊断", "qr decode report", "qr解码报告"],
  },

  wavHeader: {
    what: "WAV 头解析：拆开 WAV 音频文件的 RIFF/WAVE 结构，读出采样率、位深、声道数和时长——音频隐写题的第一步。",
    principle:
      "WAV 是 RIFF 容器：开头 `RIFF....WAVE`，之后由若干 chunk 组成。`fmt ` 块记录格式码/声道数/采样率/位深，`data` 块是 PCM 样本本体。遍历 chunk 就能读全部参数，data 块大小÷(采样率×声道×位深/8) 得时长。",
    usage: "粘 WAV 数据（hex/base64/UTF-8 自动识别），输出各 chunk + fmt 参数 + 时长。",
    examples: [
      { in: "WAV 文件字节", out: "采样率44100, 16位, 立体声, 3.2s" },
    ],
    tips: ["音频题先看头：采样率/位深决定 audioLsb 怎么取位。异常的额外 chunk 可能藏数据。"],
    aka: ["wav头", "wav header", "riff解析", "wave结构", "wav头解析", "wav文件头", "riff wave", "音频头解析", "wav format chunk", "pcm头解析", "wave file header"],
  },

  audioLsb: {
    what: "音频 LSB 提取：和图片 LSB 一个思路，把秘密藏在 WAV 每个 PCM 采样值的最低位里，逐样本抠出来拼成隐藏比特流。",
    principle:
      "PCM 样本是整数（8/16/24/32 位）。改采样值最低位只让音量变动极微、人耳听不出，却能逐样本塞 1 比特。提取时按位深读出每个样本，取最低位（或多位）拼成比特流，再按 8 位一字节还原成文本/hex。",
    usage: "输入 WAV，选位深、声道和每样本取几位，工具抠出 LSB 比特流并尝试还原文本/hex。",
    examples: [
      { in: "WAV PCM", param: "16位/左声道/每样本1位", out: "隐藏的 flag{...}" },
    ],
    tips: ["先用 wavHeader 确认位深和声道再取位。取位数/声道选错会得到乱码，多试几种组合。"],
    aka: ["音频lsb", "audio lsb", "wav隐写", "音频隐写", "音频最低位隐写", "audio steganography", "pcm lsb", "wav lsb提取", "音频最低有效位", "audio lsb extract", "声音隐写"],
  },

  dtmfDecode: {
    what: "DTMF 双音多频提取：电话拨号那种「嘟嘟」按键音，每个键是两个特定频率叠加，从 WAV 里检出来还原成按键序列。",
    principle:
      "DTMF 把 12/16 个按键排成 4 行×4 列，每键 = 一个行频 + 一个列频（共 8 个标准频率）叠加。用 Goertzel 算法（只测这 8 个频率能量的高效 DFT）在滑动窗口里检测哪两个频率能量最强，查表得对应按键。",
    usage: "输入含拨号音的 WAV PCM，工具滑窗跑 Goertzel 检测，输出按键序列（0-9 A-D * #）。",
    examples: [
      { in: "含拨号音的 WAV", out: "按键序列如 1234#" },
    ],
    formulas: [
      { tex: "\\text{key} = (\\text{行频},\\ \\text{列频}) \\to \\{697/770/852/941\\} \\times \\{1209/1336/1477/1633\\}", caption: "行频×列频定位按键" },
    ],
    tips: ["音频听起来像电话拨号/按键音 → 试 DTMF。解出的数字串可能是密码或坐标。"],
    aka: ["dtmf", "双音多频", "拨号音解码", "goertzel"],
  },

  sstvIdent: {
    what: "SSTV 模式识别：业余无线电用声音传图片（慢扫描电视），先认出音频用的是哪种 SSTV 模式，为后续解调铺路。",
    principle:
      "SSTV 图像编码成音频前，会先发一段 1200Hz 起始同步脉冲 + VIS 码（一串标识模式的音调）。检测这段头就能判断是 Robot/Scottie/Martin/PD 里的哪种模式。本工具只做识别标注，不解调出图像。",
    usage: "输入 SSTV 音频，工具检测同步脉冲 + VIS 码，标注可能的 SSTV 模式。",
    examples: [
      { in: "SSTV 音频", out: "检测到 VIS 码 → 疑似 Scottie S1 模式" },
    ],
    tips: ["音频频谱像逐行扫描的图 + 开头有同步音 → SSTV。实际出图用 RX-SSTV/QSSTV 等专门软件解调。"],
    aka: ["sstv", "慢扫描电视", "sstv识别", "vis码", "slow scan television", "sstv模式识别", "sstv mode", "无线电传图", "vis code", "scottie martin robot", "业余无线电图像"],
  },
};
