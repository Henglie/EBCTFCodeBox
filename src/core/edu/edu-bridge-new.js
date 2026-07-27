/*
 * edu-bridge-new.js — 本地桥/exe 桥接类 op 的科普数据分片（纯数据，无副作用）。
 *
 * 覆盖 15 个「调本机 exe / 启动本机 GUI」的桥接 op。这些 op 本质是外部工具的包装：
 * - GUI 型（*Launch）：只调 bridge /api/launch 拉起本机 exe，用户在弹窗里手动操作
 * 工具箱不代喂输入、不代取结果。
 * - CLI 型（*Bridge / *Exe）：调 bridge /api/run 无人值守执行，文件走 {占位符} 传入。
 * 共同前提：仅 Windows、需先在本机跑 python bridge.py（监听 localhost:8181）
 * 桥未起 / 非 Win 时 op 返回友好提示、不抛错。零外发（只连 localhost）。
 *
 * 本文件只导出数据，由主控 eduContent.js 接线，无 import / register。
 */
export default {
 // ============================================================
 // GUI 启动器（bridgeStego）
 // ============================================================
  watermarkhLaunch: {
    what: "启动本机的 watermarkH 图像水印隐写工具（吾爱破解出品）的一个按钮。",
    principle:
      "watermarkH 是一款把文字/图片当作水印藏进载体图像、或从图像里提取水印的国产 GUI 隐写工具，" +
      "在吾爱破解论坛流传，CTF 图片 misc 题里常见。\n\n" +
      "本 op 不做任何图像处理：它只通过本地桥 bridge.py 的 /api/launch 接口把本机的 watermarkH.exe 拉起来，" +
      "真正的藏/取操作全在弹出的程序窗口里由你手动完成。",
    usage:
      "仅 Windows。先在本机运行 python bridge.py（监听 localhost:8181），刷新本页后点击本功能即可拉起 watermarkH 窗口。" +
      "这是纯 GUI 启动器：工具箱不接收输入、也不返回结果，所有隐写操作请在弹出的 watermarkH 窗口里手动做。",
    examples: [
      {
        in: "（无输入，直接点击）",
        out: "● 已启动本机 exe：watermarkH · 水印\n路径：...\n请在弹出的程序窗口里手动操作。",
        desc: "点击后桥拉起 watermarkH.exe，其余在原生窗口操作。",
      },
    ],
    tips: [
      "拿到一张可疑图片先用它试试有没有隐藏水印，很多国产 misc 题就靠它。",
      "桥没起会返回「本地桥未就绪」，先确认 python bridge.py 在跑、且是 Windows。",
    ],
    aka: [
      "watermarkH", "watermark", "图像水印", "水印隐写", "吾爱破解", "52pojie",
      "图片隐写", "watermarkH.exe", "image watermark", "steganography", "misc 隐写",
    ],
  },

  jphswinLaunch: {
    what: "启动本机的 JPHS for Windows（jphide/jpseek），把数据藏进 JPEG 或从中取出。",
    principle:
      "JPHS = JP Hide and Seek，由 Allan Latham 编写。jphide 把数据嵌入 JPEG 的 DCT 系数、" +
      "jpseek 反向提取，都是密码保护的经典 JPEG 隐写对。JPHSwin 是它的 Windows 图形版。\n\n" +
      "本 op 只调桥的 /api/launch 拉起 JPHSwin.exe，藏/取由你在窗口里点。",
    usage:
      "仅 Windows，需先起 python bridge.py。点击拉起 JPHSwin 窗口后，在里面 Open jpeg → Hide/Seek，" +
      "输入密码手动完成。纯 GUI 启动器，工具箱不代喂输入取结果。",
    examples: [
      {
        in: "（无输入，直接点击）",
        out: "● 已启动本机 exe：JPHS · JPEG 隐写\n路径：...\n请在弹出的窗口里手动操作。",
        desc: "拉起 JPHSwin，在原生窗口做 jphide/jpseek。",
      },
    ],
    tips: [
      "stegdetect 报 jphide(*) 时，就用 JPHS 的 jpseek 配密码提取。",
      "jphide 只吃 JPEG，其它格式无效。",
    ],
    aka: [
      "JPHS", "JPHSwin", "jphide", "jpseek", "JP Hide and Seek", "JPEG 隐写",
      "DCT 隐写", "Allan Latham", "JPHS for Windows", "图像隐写", "jphide and seek", "misc",
    ],
  },

  openpuffLaunch: {
    what: "启动本机的 OpenPuff 多载体隐写工具（图/音/视/PDF/flash 等），支持多层密码。",
    principle:
      "OpenPuff 是 Cosimo Oliboni 的免费专业级隐写工具，可把数据分散嵌入多种载体（BMP/JPG/PNG/MP3/WAV/" +
      "MP4/PDF/SWF 等），支持三层密码、去重、伪装（decoy）等高级特性，抗检测能力较强。\n\n" +
      "本 op 只调桥的 /api/launch 拉起 OpenPuff.exe，隐写/提取在窗口里手动做。",
    usage:
      "仅 Windows，需先起 python bridge.py。点击拉起 OpenPuff 窗口后，Hide/Unhide 选载体、填三层密码手动操作。" +
      "纯 GUI 启动器，工具箱不代喂输入取结果。",
    examples: [
      {
        in: "（无输入，直接点击）",
        out: "● 已启动本机 exe：OpenPuff · 多载体\n路径：...\n请在弹出的窗口里手动操作。",
        desc: "拉起 OpenPuff，多载体隐写在原生窗口完成。",
      },
    ],
    tips: [
      "题目给多个同类文件 + 提示多层密码时，优先怀疑 OpenPuff。",
      "三层密码全对才能取出，缺一不可；注意载体顺序也可能是密钥的一部分。",
    ],
    aka: [
      "OpenPuff", "openpuff", "多载体隐写", "Cosimo Oliboni", "carrier chain",
      "多层密码", "steganography", "隐写", "decoy", "OpenPuff.exe", "professional steganography", "misc 隐写",
    ],
  },

  oursecretLaunch: {
    what: "启动本机的 OurSecret GUI 隐写工具（私有格式，无法纯前端复刻）。",
    principle:
      "OurSecret（有时写作 Our Secret）是一款把文件/文本用密码加密后藏进图片或声音文件的 GUI 隐写工具，" +
      "采用私有嵌入格式，CTF 里若给出 .ourse 或提示 OurSecret 即用它提取。\n\n" +
      "本 op 只调桥的 /api/launch 拉起 OurSecret.exe，藏/取在窗口里手动做。",
    usage:
      "仅 Windows，需先起 python bridge.py。点击拉起 OurSecret 窗口后，选载体、填密码 Hide/Unhide 手动操作。" +
      "纯 GUI 启动器，工具箱不代喂输入取结果；因格式私有无法用其它工具替代。",
    examples: [
      {
        in: "（无输入，直接点击）",
        out: "● 已启动本机 exe：OurSecret · 隐写\n路径：...\n请在弹出的窗口里手动操作。",
        desc: "拉起 OurSecret，在原生窗口做私有格式提取。",
      },
    ],
    tips: [
      "题目明确点名 OurSecret 或载体用其它隐写工具都测不出时，试它。",
      "密码常藏在题目描述/图片 exif/附件里，逐一试。",
    ],
    aka: [
      "OurSecret", "Our Secret", "oursecret", "私有格式隐写", "图片隐写", "音频隐写",
      "密码隐写", "steganography", "隐写工具", "OurSecret.exe", "hide data", "misc",
    ],
  },

 // ============================================================
 // CLI 桥接（bridgeStego）
 // ============================================================
  steghideBridge: {
    what: "调本机 steghide.exe 往图/音里嵌入数据，或把藏进去的数据提取出来。",
    principle:
      "steghide 是经典命令行隐写工具，支持 JPEG/BMP/WAV/AU 载体，用密码把数据嵌入并可选压缩/校验。\n\n" +
      "本 op 通过本地桥的 /api/run 无人值守调用 steghide.exe：\n" +
      "  extract 子命令从载体取数据、embed 子命令往载体藏数据；\n" +
      "  载体文件走 {cover} 占位符传给桥（你拖入文件粘 base64，桥落地成临时文件再替换 {cover}）。",
    usage:
      "仅 Windows，需先起 python bridge.py。载体拖进去取 base64 填到 {cover} 那栏，" +
      "参数默认 extract -sf {cover}，带密码就写 extract -sf {cover} -p 密码。" +
      "结果以 [exit 码] + stdout/stderr 形式返回。CLI 类走占位符文件，不用手动开窗口。",
    examples: [
      {
        in: "参数：extract -sf {cover} -p 123456　{cover}=可疑图.jpg 的 base64",
        out: "[exit 0]\nwrote extracted data to \"...\".",
        desc: "带密码从 JPEG 提取隐藏数据。",
      },
    ],
    tips: [
      "extract 空密码就直接回车（-p 后留空或不加 -p），很多题密码就是空。",
      "steghide 只认 jpg/bmp/wav/au；png 载体它不吃，别浪费时间。",
      "密码常写在题面、图片 exif 或另一附件里。",
    ],
    aka: [
      "steghide", "隐写工具", "steganography", "embed", "extract", "JPEG 隐写",
      "WAV 隐写", "命令行隐写", "steghide.exe", "-sf", "-p 密码", "图片隐写", "misc",
    ],
  },

  snowBridge: {
    what: "调本机 snow.exe 用行尾的空白字符（空格/Tab）在文本里藏数据。",
    principle:
      "snow = Steganographic Nature Of Whitespace，Matthew Kwan 编写。它把数据编码成每行末尾追加的" +
      "空格和 Tab 组合（打印/显示时不可见），可选 ICE 加密。因为只动行尾空白，正文肉眼看不出差别。\n\n" +
      "本 op 通过桥的 /api/run 调 snow.exe，文本文件走 {in} 占位符。",
    usage:
      "仅 Windows，需先起 python bridge.py。文本文件拖入取 base64 填 {in}。" +
      "默认参数 -C {in} 是提取（-C 表示解压/取出内容）；藏数据写 -p 密码 -m \"消息\" in.txt out.txt。" +
      "CLI 类走占位符文件。",
    examples: [
      {
        in: "参数：-C {in}　{in}=末尾带隐藏空白的 .txt 的 base64",
        out: "[exit 0]\n<藏在行尾空白里的消息>",
        desc: "从文本行尾空白中还原隐藏消息。",
      },
    ],
    tips: [
      "拿到「看起来正常但每行末尾有诡异空格」的文本就试 snow。",
      "带密码时 -p 密码要和藏入时一致，否则出乱码。",
      "用 cat -A 或 hex 看一眼行尾能确认有没有可疑空白。",
    ],
    aka: [
      "snow", "whitespace steganography", "空白隐写", "行尾空白", "空格 Tab 隐写",
      "Matthew Kwan", "SNOW", "文本隐写", "snow.exe", "ICE 加密", "whitespace", "misc",
    ],
  },

  jstegBridge: {
    what: "调本机 jsteg.exe 对 JPEG 做 LSB 隐写的读写。",
    principle:
      "jsteg 把数据藏进 JPEG 压缩后 DCT 系数的最低有效位（LSB），是最经典的 JPEG LSB 隐写实现之一。\n\n" +
      "本 op 通过桥的 /api/run 调 jsteg.exe：reveal 子命令从 JPEG 里读出藏的数据；" +
      "JPEG 文件走 {jpg} 占位符传给桥。",
    usage:
      "仅 Windows，需先起 python bridge.py。JPEG 拖入取 base64 填 {jpg}，默认参数 reveal {jpg} 即提取。" +
      "CLI 类走占位符文件，结果以 [exit 码] + stdout 返回。",
    examples: [
      {
        in: "参数：reveal {jpg}　{jpg}=可疑 JPEG 的 base64",
        out: "[exit 0]\nflag{...}",
        desc: "从 JPEG 的 LSB 里读出隐藏数据。",
      },
    ],
    tips: [
      "stegdetect 报 jsteg(*) 就用 jsteg reveal 提取。",
      "只对 JPEG 有效；且要求是 jsteg 藏的，其它 LSB 方案未必读得出。",
    ],
    aka: [
      "jsteg", "JPEG LSB", "LSB 隐写", "reveal", "DCT LSB", "JPEG 隐写",
      "最低有效位", "steganography", "jsteg.exe", "least significant bit", "图片隐写", "misc",
    ],
  },

  mp3stegoBridge: {
    what: "调本机 MP3Stego 的 Decode 从 MP3 里还原藏入的数据。",
    principle:
      "MP3Stego（Fabien Petitcolas）在 MP3 编码的内循环阶段把数据藏进量化过程，Encode 藏、Decode 取，" +
      "都带密码。因为嵌在压缩过程里，普通播放/查看无异常。\n\n" +
      "本 op 通过桥的 /api/run 调 MP3Stego Decode：MP3 文件走 {mp3} 占位符。",
    usage:
      "仅 Windows，需先起 python bridge.py。MP3 拖入取 base64 填 {mp3}，默认参数 -X {mp3} 提取" +
      "（-X 表示解出隐藏数据），带密码写 -X {mp3} -P 密码。CLI 类走占位符文件。",
    examples: [
      {
        in: "参数：-X {mp3} -P mypass　{mp3}=可疑 MP3 的 base64",
        out: "[exit 0]\n（还原出的 hidden.txt 内容 / 提取完成信息）",
        desc: "带密码从 MP3 还原隐藏数据。",
      },
    ],
    tips: [
      "题目给 mp3 + 提示密码，几乎就是 MP3Stego。",
      "-P 密码必须和藏入时一致，错了取不出。",
      "MP3Stego 只认自己 Encode 藏的数据，非它藏的 mp3 无效。",
    ],
    aka: [
      "MP3Stego", "mp3stego", "MP3 隐写", "Decode", "-X", "Fabien Petitcolas",
      "音频隐写", "steganography", "mp3 stego", "-P 密码", "compressed-domain", "misc",
    ],
  },

 // ============================================================
 // CLI 桥接（bridgeForensic）
 // ============================================================
  stegdetectExe: {
    what: "调本机 stegdetect.exe 检测 JPEG 里可能藏了哪种隐写（jsteg/jphide/outguess/invisible secrets 等）。",
    principle:
      "stegdetect（Niels Provos）用统计特征扫描 JPEG，判断它是否被 jsteg、jphide、outguess、" +
      "invisible secrets 等工具做过隐写，并给出置信度。它只检测、不提取。\n\n" +
      "本 op 通过桥的 /api/run 调 stegdetect.exe：JPEG 走 {jpg} 占位符，-t 指定检测算法、-s 设灵敏度。",
    usage:
      "仅 Windows，需先起 python bridge.py。JPEG 拖入取 base64 填 {jpg}，默认参数 -t jopi {jpg}" +
      "（jopi = 检测 jsteg/outguess/jphide/invisible secrets 四类），提高灵敏度写 -s 3.0 {jpg}。CLI 类走占位符文件。",
    examples: [
      {
        in: "参数：-t jopi {jpg}　{jpg}=可疑 JPEG 的 base64",
        out: "[exit 0]\nchall.jpg : jphide(***)",
        desc: "报告该 JPEG 疑似用 jphide 隐写，星号越多置信度越高。",
      },
    ],
    tips: [
      "先用它定位算法，再决定用 jsteg reveal 还是 JPHS 的 jpseek 去提取。",
      "报 negative 不代表没藏；换更高 -s 灵敏度或别的工具再试。",
      "-t 各字母：j=jsteg、o=outguess、p=jphide、i=invisible secrets。",
    ],
    aka: [
      "stegdetect", "JPEG 隐写检测", "Niels Provos", "jsteg", "jphide", "outguess",
      "invisible secrets", "-t jopi", "-s 灵敏度", "steganalysis", "stegdetect.exe", "隐写分析", "misc",
    ],
  },

  ntfsstreamsLaunch: {
    what: "启动本机的 NTFS 备用数据流（ADS）查看/编辑器。",
    principle:
      "NTFS 文件系统允许一个文件挂多个「备用数据流」（Alternate Data Stream，如 file.txt:hidden），" +
      "主流内容正常显示、附加流默认不可见，常被用来藏 flag 或恶意数据。\n\n" +
      "本 op 只调桥的 /api/launch 拉起本机的 ADS 编辑器 GUI，查看/编辑在窗口里手动做。",
    usage:
      "仅 Windows，需先起 python bridge.py。点击拉起 ADS 编辑器窗口后手动查看/编辑数据流。" +
      "纯 GUI 启动器，工具箱不代喂输入取结果。（命令行下也可用 dir /r 列流、type file:stream 读流。）",
    examples: [
      {
        in: "（无输入，直接点击）",
        out: "● 已启动本机 exe：NTFS 数据流\n路径：...\n请在弹出的窗口里手动操作。",
        desc: "拉起 ADS 编辑器，在窗口里查看隐藏数据流。",
      },
    ],
    tips: [
      "题目给 NTFS 分区镜像或明说 ADS，就查每个文件有没有附加流。",
      "命令行速查：dir /r 看 : 后缀的流，more < file.txt:secret.txt 读内容。",
      "ADS 只在 NTFS 上存在，拷到 FAT/exFAT 会丢。",
    ],
    aka: [
      "NTFS ADS", "Alternate Data Stream", "备用数据流", "ntfsstreams", "NTFS 数据流",
      "隐藏数据流", "dir /r", "文件流隐藏", "ADS", "NTFS", "data stream", "misc 取证",
    ],
  },

  foremostBridge: {
    what: "调本机 foremost.exe 按文件头/尾特征从数据里雕复（carve）出内嵌的文件。",
    principle:
      "foremost 是经典文件雕复工具，靠已知文件格式的魔数头（如 PNG 的 89504E47、ZIP 的 504B0304）和尾特征，" +
      "从任意数据流里扫描并切出完整文件，常用于从图片/磁盘镜像里抠出被拼接/隐藏的附件。\n\n" +
      "本 op 通过桥的 /api/run 调 foremost.exe：待雕复文件走 {in} 占位符，-o 指定输出目录。",
    usage:
      "仅 Windows，需先起 python bridge.py。文件拖入取 base64 填 {in}，默认参数 -i {in} -o out" +
      "（-i 输入、-o 输出目录）。CLI 类走占位符文件，结果里会列出雕复到的文件类型和数量。",
    examples: [
      {
        in: "参数：-i {in} -o out　{in}=图里藏了 ZIP 的 png 的 base64",
        out: "[exit 0]\nProcessing: {in}\n|foundat=...|\n... zip: 1 ...",
        desc: "从 PNG 里雕出被附加在后面的 ZIP。",
      },
    ],
    tips: [
      "「一张图 binwalk 看到里面还有别的文件」时，foremost 帮你切出来。",
      "-o 目录必须不存在或为空，否则 foremost 会报错拒绝写。",
      "和 binwalk 互补：foremost 靠魔数，能补 binwalk 漏切的场景。",
    ],
    aka: [
      "foremost", "文件雕复", "file carving", "carve", "数据恢复", "魔数",
      "file signature", "magic number", "foremost.exe", "取证", "-i -o", "内嵌文件提取", "misc 取证",
    ],
  },

  bkcrackBridge: {
    what: "调本机 bkcrack.exe 对 ZipCrypto 加密的 ZIP 做已知明文攻击，求出内部密钥。",
    principle:
      "传统 ZIP 的 ZipCrypto 流加密有已知明文攻击（Biham-Kocher）：只要知道压缩包里某个文件的" +
      "至少 12 字节明文（通常需 ≥ 若干字节），bkcrack 就能恢复内部三个 32 位密钥，进而解密全部条目、" +
      "甚至无需原密码。\n\n" +
      "本 op 通过桥的 /api/run 调 bkcrack.exe：ZIP 走 {zip} 占位符，-c 指定包内目标文件名、-p 给明文。",
    usage:
      "仅 Windows，需先起 python bridge.py。ZIP 拖入取 base64 填 {zip}，参数形如" +
      " -C {zip} -c inner.txt -p plain.bin（-C 加密包、-c 包内文件名、-p 明文文件）。CLI 类走占位符文件。",
    examples: [
      {
        in: "参数：-C {zip} -c flag.txt -p known.bin",
        out: "[exit 0]\nKeys: 12345678 9abcdef0 ...",
        desc: "用已知明文恢复出三个内部密钥，之后可 -d 解密其它文件。",
      },
    ],
    tips: [
      "只对 ZipCrypto（传统 ZIP 加密）有效，AES 加密的 zip 无效。",
      "明文来源：包内已知的公共文件、固定文件头、或另一处泄露的同一文件。",
      "拿到 Keys 后用 bkcrack -C {zip} -k 密钥 -d out.zip 解出明文包。",
    ],
    aka: [
      "bkcrack", "ZipCrypto", "已知明文攻击", "known plaintext attack", "Biham-Kocher",
      "ZIP 破解", "zip crypto", "内部密钥", "bkcrack.exe", "-C -c -p", "plaintext attack", "misc crypto",
    ],
  },

  dtmf2numBridge: {
    what: "调本机 dtmf2num.exe 从 WAV 拨号音里解出对应的 DTMF 按键序列。",
    principle:
      "DTMF（双音多频）是电话按键音，每个键对应两个固定频率的叠加。dtmf2num 分析 WAV 里的音频，" +
      "识别出这些双频组合并还原成数字/符号按键串（0-9、* 、# 等）。\n\n" +
      "本 op 通过桥的 /api/run 调 dtmf2num.exe：WAV 走 {wav} 占位符。",
    usage:
      "仅 Windows，需先起 python bridge.py。WAV 拖入取 base64 填 {wav}，默认参数就是 {wav}（直接分析该文件）。" +
      "CLI 类走占位符文件，结果里给出识别到的按键序列。",
    examples: [
      {
        in: "参数：{wav}　{wav}=一段拨号音 WAV 的 base64",
        out: "[exit 0]\nDTMF: 1234567890",
        desc: "从拨号音还原出按键序列。",
      },
    ],
    tips: [
      "音频题里听到「嘟嘟」像电话拨号的，先想 DTMF。",
      "识别到的按键可能是 flag、也可能要再按电话九宫格映射成字母。",
      "只吃 WAV；mp3 先转成 wav 再喂。",
    ],
    aka: [
      "dtmf2num", "DTMF", "双音多频", "拨号音", "电话按键音", "Dual-Tone Multi-Frequency",
      "音频解码", "touch tone", "dtmf2num.exe", "WAV 解码", "音频隐写", "misc 音频",
    ],
  },

 // ============================================================
 // CLI 桥接（bridgeLang）
 // ============================================================
  bftoolsExe: {
    what: "调本机 bftools.exe 跑 Brainfuck 相关子命令：执行 BF 源码，或处理 brainloller/braincopter 图像隐写。",
    principle:
      "Brainfuck 是只有 8 个符号（+-<>[].,）的极简语言。bftools 是一套围绕 BF 的工具集：\n" +
      "  run 执行一段 BF 源码；\n" +
      "  brainloller 把 BF 程序编码成彩色像素图、braincopter 把 BF 藏进任意图片的像素里，" +
      "  encode/decode 子命令在「BF 源码 ⇄ 图像」之间转换。\n\n" +
      "本 op 通过桥的 /api/run 调 bftools.exe：BF 源码从 stdin 传入（配 run - 参数），" +
      "图像走 {img} 占位符（配 encode/decode）。",
    usage:
      "仅 Windows，需先起 python bridge.py。执行 BF：参数写 run -，源码填 stdin。" +
      "解 braincopter/brainloller 图像隐写：参数写 decode braincopter {img}，图像拖入取 base64 填 {img}。CLI 类。",
    examples: [
      {
        in: "参数：run -　stdin：++++++++[>++++++++<-]>+.",
        out: "[exit 0]\nA",
        desc: "执行一段 BF 源码，输出字符 A。",
      },
      {
        in: "参数：decode braincopter {img}　{img}=braincopter 图的 base64",
        out: "[exit 0]\n（还原出的 BF 源码）",
        desc: "从 braincopter 图像里还原出 Brainfuck 源码。",
      },
    ],
    tips: [
      "看到一张色块很规整、疑似藏码的图，试 decode braincopter/brainloller。",
      "解出 BF 源码后再 run - 执行即得明文。",
      "纯 BF 源码题直接 run - 喂 stdin 最省事。",
    ],
    aka: [
      "bftools", "Brainfuck", "BF", "brainloller", "braincopter", "esoteric language",
      "深奥语言", "图像隐写", "run encode decode", "bftools.exe", "brainfuck 解释器", "misc",
    ],
  },

  npietExe: {
    what: "调本机 npiet.exe 执行 Piet 图像程序（png/gif 等），把图当代码跑出结果。",
    principle:
      "Piet 是一种「程序就是一张抽象画」的深奥语言（得名于画家 Mondrian）：由 20 种颜色的色块组成，" +
      "指令指针在色块间移动、按相邻块的色相/明度差决定操作。npiet 是它的解释器。\n\n" +
      "本 op 通过桥的 /api/run 调 npiet.exe：Piet 图像走 {img} 占位符，-e 限制最大执行步数（防死循环），" +
      "程序输出回 stdout。",
    usage:
      "仅 Windows，需先起 python bridge.py。Piet 图像拖入取 base64 填 {img}，默认参数 -e 1000000 {img}" +
      "（-e 限步、防死循环）；想看执行轨迹用 -v {img}。CLI 类走占位符文件。",
    examples: [
      {
        in: "参数：-e 1000000 {img}　{img}=一张 Piet 程序图的 base64",
        out: "[exit 0]\nHello, world!",
        desc: "把这张彩色块图当 Piet 程序执行，输出结果。",
      },
    ],
    tips: [
      "拿到「像马赛克/抽象画、色块边界很清晰」的图，先想 Piet。",
      "程序不停就调小 -e 步数上限；-v 看指令轨迹帮你调试。",
      "npiet 认 png/gif/ppm 等；确保图没被缩放（codel 大小会变）。",
    ],
    aka: [
      "npiet", "Piet", "esoteric language", "深奥语言", "图像编程语言", "Mondrian",
      "色块编程", "-e 步数", "npiet.exe", "codel", "Piet 解释器", "misc",
    ],
  },
};
